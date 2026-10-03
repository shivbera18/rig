/** OAuth authorization-code + device-code engines (Step 2).
 * Simplified generic port of OMP `engine/oauth-code.ts` + `engine/device-code.ts`:
 * same PKCE S256 / loopback-callback / device-poll semantics, driven by the
 * static `RigLoginProviderDef` table instead of compiled KDL. Provider-specific
 * extras (custom authorize params, token-body shapes, after-exchange hooks) are
 * intentionally NOT ported: each OAuth provider keeps a manual `hookId` row
 * until its exact exchange is verified against the live endpoint.
 */

import { createServer } from "node:http";
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
    readonly openBrowser?: (url: string) => void;
    readonly onManualCodeInput?: (signal?: AbortSignal) => Promise<string>;
  },
): Promise<RigOAuthCredentials> {
  throwIfCancelled(options.signal);
  if (!def.authorizeUrl) throw new Error(`${def.name} OAuth login is not configured`);
  const port = def.callbackPort ?? 0;
  const path = def.callbackPath ?? "/callback";
  const { verifier, challenge } = await generatePKCE();
  const state = crypto.randomUUID();
  const uri = redirectUri(port, path);
  const authorize = new URL(def.authorizeUrl);
  if (def.clientId) authorize.searchParams.set("client_id", def.clientId);
  authorize.searchParams.set("redirect_uri", uri);
  authorize.searchParams.set("response_type", "code");
  if (def.scopes?.length) authorize.searchParams.set("scope", def.scopes.join(" "));
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("state", state);

  if (def.instructions) options.onProgress?.(def.instructions);
  options.onAuth?.({ url: authorize.toString(), instructions: def.instructions ?? "" });

  const code = await waitForOAuthCallback({
    port,
    path,
    expectedState: state,
    openUrl: authorize.toString(),
    openBrowser: options.openBrowser,
    portFallback: def.portFallback ?? true,
    manualOnly: def.manualOnly ?? false,
    onManualCodeInput: options.onManualCodeInput ?? options.onPrompt
      ? async (signal) =>
          options.onPrompt?.({
            message: "Paste the authorization code (or full redirect URL)",
          }).then((answer) => {
            if (signal?.aborted) throw new RigLoginCancelledError();
            return answer;
          }) ?? ""
      : undefined,
    signal: options.signal,
  });
  throwIfCancelled(options.signal);

  const fetchImpl = options.fetch ?? fetch;
  const body = options.exchangeBody
    ? options.exchangeBody({ code, verifier, redirectUri: uri })
    : {
        grant_type: "authorization_code",
        code,
        redirect_uri: uri,
        client_id: def.clientId ?? "",
        code_verifier: verifier,
      };
  const tokenResponse = await fetchImpl(options.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    signal: options.signal,
  });
  if (!tokenResponse.ok) {
    const details = await tokenResponse.text().catch(() => "");
    throw new Error(
      details.trim()
        ? `${def.name} token exchange failed (${tokenResponse.status}): ${details.trim()}`
        : `${def.name} token exchange failed (${tokenResponse.status})`,
    );
  }
  const tokenBody = (await tokenResponse.json()) as Record<string, unknown>;
  const access = tokenBody["access_token"];
  if (typeof access !== "string" || !access) throw new Error(`${def.name} token exchange returned no access token`);
  const refresh = tokenBody["refresh_token"];
  const expiresIn = tokenBody["expires_in"];
  return {
    access,
    refresh: typeof refresh === "string" ? refresh : "",
    expires:
      typeof expiresIn === "number" && Number.isFinite(expiresIn) ? Date.now() + expiresIn * 1000 : NEVER_EXPIRES,
  };
}

async function waitForOAuthCallback(options: {
  port: number;
  path: string;
  expectedState: string;
  openUrl: string;
  openBrowser?: (url: string) => void;
  portFallback: boolean;
  manualOnly: boolean;
  onManualCodeInput?: (signal?: AbortSignal) => Promise<string>;
  signal?: AbortSignal;
}): Promise<string> {
  if (options.manualOnly) {
    if (!options.onManualCodeInput) throw new Error("This provider needs a manual redirect-URL paste");
    return extractCode(await options.onManualCodeInput(options.signal));
  }
  try {
    return await listenForOAuthCallback(options);
  } catch (error) {
    if (!options.portFallback || !options.onManualCodeInput) throw error;
    return extractCode(await options.onManualCodeInput(options.signal));
  }
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

async function listenForOAuthCallback(options: {
  port: number;
  path: string;
  expectedState: string;
  openUrl: string;
  openBrowser?: (url: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const address = options.port === 0 ? "127.0.0.1" : "localhost";
  return new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        if (url.pathname !== options.path) {
          res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
          return;
        }
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        if (!code || (state !== null && state !== options.expectedState)) {
          res.writeHead(400, { "Content-Type": "text/plain" }).end("Invalid callback");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" }).end("<h1>Signed in. Return to Rig.</h1>");
        cleanup();
        resolve(code);
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
    const cleanup = () => {
      server.close();
      options.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new RigLoginCancelledError());
    };
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });
    server.on("error", (error) => {
      cleanup();
      reject(error);
    });
    server.listen(options.port === 0 ? 0 : options.port, address, () => {
      try {
        options.openBrowser?.(options.openUrl);
      } catch {
        // Best-effort browser open; URL is already shown via onAuth.
      }
    });
  });
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
  const device = (await deviceResponse.json()) as Record<string, unknown>;
  const userCode = device["user_code"];
  const deviceCode = device["device_code"];
  const verificationUri = device["verification_uri"];
  const verificationUriComplete = device["verification_uri_complete"];
  if (typeof userCode !== "string" || !userCode || typeof deviceCode !== "string" || !deviceCode) {
    throw new Error(`${def.name} device authorization returned an invalid response`);
  }
  const shownUri =
    typeof verificationUriComplete === "string" && verificationUriComplete
      ? verificationUriComplete
      : typeof verificationUri === "string"
        ? verificationUri
        : "";
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
      const timer = setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now())));
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new RigLoginCancelledError());
      }, { once: true });
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
    const body = (await poll.json().catch(() => ({}))) as Record<string, unknown>;
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
    const description = typeof body["error_description"] === "string" ? body["error_description"] : "";
    throw new Error(
      description.trim()
        ? `${def.name} device grant failed: ${description.trim()}`
        : `${def.name} device grant failed (${poll.status})`,
    );
  }
  throw new Error(`${def.name} device authorization timed out`);
}
