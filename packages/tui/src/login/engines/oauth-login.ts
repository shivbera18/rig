/** OAuth authorization-code + device-code engines (Step 2).
 * Simplified generic port of OMP `engine/oauth-code.ts` + `engine/device-code.ts`:
 * same PKCE S256 / loopback-callback / device-poll semantics, driven by the
 * static `RigLoginProviderDef` table instead of compiled KDL. Per-provider
 * authorize params, client secrets aside, are transcribed into the table;
 * provider-specific token-body shapes and after-exchange hooks are
 * intentionally NOT ported: unwired OAuth providers keep pointing at
 * manual setup until their exact exchange is verified live.
 */

import { createServer } from "node:http";
import { generatePKCE } from "./pkce.js";
import type { RigLoginController } from "./api-key-login.js";
import { RigLoginCancelledError } from "./api-key-login.js";
import type { RigLoginProviderDef } from "../provider-login-registry.js";

export interface RigOAuthCredentials {
  readonly access: string;
  readonly refresh: string;
  readonly expires: number;
  readonly email?: string;
  readonly accountId?: string;
  readonly orgId?: string;
  readonly orgName?: string;
}

export const NEVER_EXPIRES = 8.64e15;

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new RigLoginCancelledError();
}

function redirectUri(port: number, path: string): string {
  return `http://localhost:${port}${path}`;
}

/**
 * Generic authorization-code flow: PKCE S256, loopback callback listener,
 * browser authorize URL, code exchange at the provider token endpoint.
 * Busy-port behaviour copies the OMP per-provider flag: exact-URI providers
 * (`portFallback: false`, e.g. openai-codex) fail loudly; others fall back to
 * a manual paste of the redirect URL/code.
 */
export async function runOAuthCodeLogin(
  def: RigLoginProviderDef,
  options: RigLoginController & {
    readonly tokenUrl: string;
    readonly exchangeBody?: (params: {
      code: string;
      verifier: string;
      redirectUri: string;
    }) => Record<string, string>;
    readonly clientSecret?: string;
    readonly exchangeProxyUrl?: string;
    readonly openBrowser?: (url: string) => void;
    readonly onManualCodeInput?: (signal?: AbortSignal) => Promise<string>;
  },
): Promise<RigOAuthCredentials> {
  throwIfCancelled(options.signal);
  if (!def.authorizeUrl) throw new Error(`${def.name} OAuth login is not configured`);
  const path = def.callbackPath ?? "/callback";
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  const listening = await startOAuthCallbackListener({
    port: def.callbackPort ?? 0,
    path,
    expectedState: state,
    openBrowser: options.openBrowser,
    signal: options.signal,
  });
  try {
    const uri = redirectUri(listening.port, path);
    const authorize = buildAuthorizeUrl(def, { challenge, state, redirectUri: uri });
    if (def.instructions) options.onProgress?.(def.instructions);
    options.onAuth?.({ url: authorize.toString(), instructions: def.instructions ?? "" });
    try {
      listening.open(authorize.toString());
    } catch {
      // Best-effort browser open; URL is already shown via onAuth.
    }
    const code = await listening.waitForCode({
      manualOnly: def.manualOnly ?? false,
      onManualCodeInput:
        options.onManualCodeInput ?? options.onPrompt
          ? async (signal) =>
              options.onPrompt?.({
                message: "Paste the authorization code (or full redirect URL)",
              }).then((answer) => {
                if (signal?.aborted) throw new RigLoginCancelledError();
                return answer;
              }) ?? ""
          : undefined,
      portFallback: def.portFallback ?? true,
      signal: options.signal,
    });
    throwIfCancelled(options.signal);
    return exchangeOAuthCode(def, code, { verifier, redirectUri: uri }, options);
  } finally {
    listening.close();
  }
}

function buildAuthorizeUrl(
  def: RigLoginProviderDef,
  params: { challenge: string; state: string; redirectUri: string },
): URL {
  const authorize = new URL(def.authorizeUrl ?? "");
  if (def.clientId) authorize.searchParams.set("client_id", def.clientId);
  for (const [key, value] of Object.entries(def.authorizeParams ?? {})) {
    authorize.searchParams.set(key, value);
  }
  authorize.searchParams.set("redirect_uri", params.redirectUri);
  authorize.searchParams.set("response_type", "code");
  if (def.scopes?.length) authorize.searchParams.set("scope", def.scopes.join(" "));
  authorize.searchParams.set("code_challenge", params.challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", params.state);
  return authorize;
}

async function exchangeOAuthCode(
  def: RigLoginProviderDef,
  code: string,
  params: { verifier: string; redirectUri: string },
  options: RigLoginController & {
    readonly tokenUrl: string;
    readonly exchangeBody?: (params: {
      code: string;
      verifier: string;
      redirectUri: string;
    }) => Record<string, string>;
    readonly clientSecret?: string;
    readonly exchangeProxyUrl?: string;
  },
): Promise<RigOAuthCredentials> {
  const fetchImpl = options.fetch ?? fetch;
  const clientSecret = options.clientSecret ?? resolveOAuthClientSecret(def);
  if (!clientSecret && options.exchangeProxyUrl) {
    return exchangeOAuthCodeViaProxy(def, code, params, options.exchangeProxyUrl, options);
  }
  const body = options.exchangeBody
    ? options.exchangeBody({ code, verifier: params.verifier, redirectUri: params.redirectUri })
    : buildOAuthExchangeBody(
        def,
        { code, verifier: params.verifier, redirectUri: params.redirectUri },
        clientSecret,
      );
  const tokenResponse = await fetchImpl(options.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: options.signal,
  });
  return parseTokenResponse(def, tokenResponse);
}

/**
 * OAuth client secret resolved from the environment (never committed to
 * git). Providers that need one name the variable via `clientSecretEnv`.
 */
export function resolveOAuthClientSecret(def: RigLoginProviderDef): string | undefined {
  const name = def.clientSecretEnv;
  if (!name) return undefined;
  const value = process.env[name];
  return value || undefined;
}

/** Standard authorization_code form body; includes client_secret only when set. */
export function buildOAuthExchangeBody(
  def: RigLoginProviderDef,
  params: { code: string; verifier: string; redirectUri: string },
  clientSecret?: string,
): Record<string, string> {
  return {
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: def.clientId ?? "",
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    code_verifier: params.verifier,
  };
}

async function exchangeOAuthCodeViaProxy(
  def: RigLoginProviderDef,
  code: string,
  params: { verifier: string; redirectUri: string },
  proxyUrl: string,
  options: RigLoginController,
): Promise<RigOAuthCredentials> {
  const fetchImpl = options.fetch ?? fetch;
  const proxyResponse = await fetchImpl(proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: def.id,
      code,
      code_verifier: params.verifier,
      redirect_uri: params.redirectUri,
    }),
    signal: options.signal,
  });
  if (!proxyResponse.ok) {
    const details = await proxyResponse.text().catch(() => "");
    throw new Error(
      details.trim()
        ? `${def.name} token exchange failed (${proxyResponse.status}): ${details.trim().slice(0, 300)}`
        : `${def.name} token exchange failed (${proxyResponse.status})`,
    );
  }
  return parseTokenResponse(def, proxyResponse);
}

async function parseTokenResponse(
  def: RigLoginProviderDef,
  tokenResponse: Response,
): Promise<RigOAuthCredentials> {
  const tokenText = await tokenResponse.text().catch(() => "");
  let tokenBody: Record<string, unknown>;
  try {
    tokenBody = (tokenText ? JSON.parse(tokenText) : {}) as Record<string, unknown>;
  } catch {
    throw new Error(
      tokenText.trim()
        ? `${def.name} token exchange returned invalid JSON: ${tokenText.trim().slice(0, 200)}`
        : `${def.name} token exchange returned an empty response`,
    );
  }
  const access: unknown = tokenBody["access_token"];
  if (typeof access !== "string" || !access) {
    throw new Error(`${def.name} token exchange returned no access token`);
  }
  const refresh: unknown = tokenBody["refresh_token"];
  const expiresIn: unknown = tokenBody["expires_in"];
  return {
    access,
    refresh: typeof refresh === "string" ? refresh : "",
    expires:
      typeof expiresIn === "number" && Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : NEVER_EXPIRES,
  };
}

function extractCode(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) return code;
  } catch {
    // Not a URL: treat the paste as the raw code.
  }
  if (!trimmed) throw new Error("Authorization code is empty");
  return trimmed;
}

interface OAuthCallbackListener {
  readonly port: number;
  readonly open: (url: string) => void;
  readonly waitForCode: (options: {
    manualOnly: boolean;
    onManualCodeInput?: (signal?: AbortSignal) => Promise<string>;
    portFallback: boolean;
    signal?: AbortSignal;
  }) => Promise<string>;
  readonly close: () => void;
}

async function startOAuthCallbackListener(options: {
  port: number;
  path: string;
  expectedState: string;
  openBrowser?: (url: string) => void;
  signal?: AbortSignal;
}): Promise<OAuthCallbackListener> {
  const address = options.port === 0 ? "127.0.0.1" : "localhost";
  let settled = false;
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: unknown) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });
  // Swallow unhandled rejection when the listener closes before a callback.
  codePromise.catch(() => undefined);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== options.path) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      } else {
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || (state !== null && state !== options.expectedState)) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid callback");
        } else {
          res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Signed in. Return to Rig.</h1>");
          if (!settled) {
            settled = true;
            options.signal?.removeEventListener("abort", onAbort);
            resolveCode(code);
          }
        }
      }
    } catch (error) {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      rejectCode(error);
    }
  });
  const onAbort = () => {
    if (settled) return;
    settled = true;
    server.close();
    rejectCode(new RigLoginCancelledError());
  };
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });
  const onListenError = (error: unknown) => {
    if (settled) return;
    settled = true;
    options.signal?.removeEventListener("abort", onAbort);
    rejectCode(error);
  };
  server.on("error", onListenError);
  const boundPort = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port === 0 ? 0 : options.port, address, () => {
      const actual = server.address();
      if (actual && typeof actual === "object" && typeof actual.port === "number") {
        resolve(actual.port);
      } else {
        reject(new Error("OAuth callback listener bound to an unknown address"));
      }
    });
  });
  return {
    port: boundPort,
    open: (url: string) => options.openBrowser?.(url),
    waitForCode: async (waitOptions) => {
      if (waitOptions.manualOnly) {
        if (!waitOptions.onManualCodeInput) {
          throw new Error("This provider needs a manual redirect-URL paste");
        }
        try {
          return extractCode(await waitOptions.onManualCodeInput(waitOptions.signal));
        } finally {
          server.close();
          options.signal?.removeEventListener("abort", onAbort);
        }
      }
      try {
        return await codePromise;
      } catch (error) {
        if (!waitOptions.portFallback || !waitOptions.onManualCodeInput) throw error;
        server.close();
        options.signal?.removeEventListener("abort", onAbort);
        return extractCode(await waitOptions.onManualCodeInput(waitOptions.signal));
      }
    },
    close: () => {
      server.close();
      options.signal?.removeEventListener("abort", onAbort);
    },
  };
}

/**
 * Generic RFC 8628 device flow: request user code, show verification URI,
 * poll the token endpoint until the grant completes.
 */
export async function runDeviceCodeLogin(
  def: RigLoginProviderDef,
  options: RigLoginController & {
    readonly deviceUrl: string;
    readonly tokenUrl: string;
    readonly extraDeviceParams?: Record<string, string>;
  },
): Promise<RigOAuthCredentials> {
  throwIfCancelled(options.signal);
  const fetchImpl = options.fetch ?? fetch;
  const deviceParams: Record<string, string> = {
    ...(def.clientId ? { client_id: def.clientId } : {}),
    ...(def.scopes?.length ? { scope: def.scopes.join(" ") } : {}),
    ...(options.extraDeviceParams ?? {}),
  };
  options.onProgress?.("Requesting device authorization...");
  const deviceResponse = await fetchImpl(options.deviceUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(deviceParams).toString(),
    signal: options.signal,
  });
  if (!deviceResponse.ok) {
    const details = await deviceResponse.text().catch(() => "");
    throw new Error(
      details.trim()
        ? `${def.name} device authorization failed (${deviceResponse.status}): ${details.trim()}`
        : `${def.name} device authorization failed (${deviceResponse.status})`,
    );
  }
  let device: Record<string, unknown>;
  try {
    const text = await deviceResponse.text().catch(() => "");
    device = ((text ? JSON.parse(text) : {}) ?? {}) as Record<string, unknown>;
  } catch {
    throw new Error(`${def.name} device authorization returned invalid JSON`);
  }
  const userCode = device["user_code"];
  const deviceCode = device["device_code"];
  const verificationUri = device["verification_uri"];
  const verificationUriComplete = device["verification_uri_complete"];
  if (typeof userCode !== "string" || !userCode || typeof deviceCode !== "string" || !deviceCode) {
    throw new Error(`${def.name} device authorization returned an invalid response`);
  }
  if (typeof verificationUri !== "string" || !verificationUri) {
    throw new Error(`${def.name} device authorization returned no verification URI`);
  }
  const shownUri =
    typeof verificationUriComplete === "string" && verificationUriComplete
      ? verificationUriComplete
      : verificationUri;
  options.onAuth?.({
    url: shownUri,
    instructions: (def.instructions ?? "Enter code: {user_code}").replace("{user_code}", userCode),
  });
  options.onProgress?.(`Enter code: ${userCode}`);
  const intervalSeconds =
    typeof device["interval"] === "number" && Number.isFinite(device["interval"])
      ? Number(device["interval"])
      : 5;
  const expiresInSeconds =
    typeof device["expires_in"] === "number" && Number.isFinite(device["expires_in"])
      ? Number(device["expires_in"])
      : undefined;
  const deadline = typeof expiresInSeconds === "number" ? Date.now() + expiresInSeconds * 1000 : Number.POSITIVE_INFINITY;
  let intervalMs = Math.max(1000, Math.floor(intervalSeconds * 1000));
  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new RigLoginCancelledError();
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        clearTimeout(timer);
        reject(new RigLoginCancelledError());
      };
      const timer = setTimeout(() => {
        options.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      if (options.signal?.aborted) {
        clearTimeout(timer);
        reject(new RigLoginCancelledError());
      } else {
        options.signal?.addEventListener("abort", onAbort, { once: true });
      }
    });
    const poll = await fetchImpl(options.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        ...(def.clientId ? { client_id: def.clientId } : {}),
      }).toString(),
      signal: options.signal,
    });
    let body: Record<string, unknown>;
    try {
      const text = await poll.text().catch(() => "");
      body = ((text ? JSON.parse(text) : {}) ?? {}) as Record<string, unknown>;
    } catch {
      throw new Error(`${def.name} device grant returned invalid JSON (${poll.status})`);
    }
    if (poll.ok) {
      const access = body["access_token"];
      if (typeof access !== "string" || !access) throw new Error(`${def.name} device grant returned no access token`);
      const refresh = body["refresh_token"];
      const expiresIn = body["expires_in"];
      return {
        access,
        refresh: typeof refresh === "string" ? refresh : "",
        expires:
          typeof expiresIn === "number" && Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : NEVER_EXPIRES,
      };
    }
    const errorCode = body["error"];
    if (errorCode === "authorization_pending") continue;
    if (errorCode === "slow_down") {
      intervalMs = Math.max(1000, intervalMs + 5000);
      continue;
    }
    if (errorCode === "expired_token") {
      throw new Error(`${def.name} device code expired; restart the login`);
    }
    if (errorCode === "access_denied") {
      throw new Error(`${def.name} device authorization was denied`);
    }
    const description = typeof body["error_description"] === "string" ? body["error_description"] : "";
    throw new Error(
      description.trim()
        ? `${def.name} device grant failed: ${description.trim()}`
        : `${def.name} device grant failed (${poll.status})`,
    );
  }
  throw new Error(`${def.name} device authorization timed out`);
}
