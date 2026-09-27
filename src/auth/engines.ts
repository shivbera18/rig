import http from "node:http";
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import readline from "node:readline";
import type { DeviceCodeLoginDef, OAuthCodeLoginDef } from "./catalog.js";

// Ports omp's registry engines (packages/ai/src/registry/engine/
// oauth-code.ts, device-code.ts, api-key.ts) reduced to fetch + node:http.
// Callers persist via upsertCredential; engines only return fresh secrets.

export interface LoginResult {
  access: string;
  refresh?: string;
  expiresAtMs?: number;
  email?: string;
}

export class LoginFailedError extends Error {}

const CALLBACK_TIMEOUT_MS = 300_000;
const TOKEN_TIMEOUT_MS = 15_000;

export function promptLine(message: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(message, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Prints the omp `Login failed: …` line and marks exit 1; throws
// LoginFailedError so callers can distinguish an already-reported failure
// (e.g. the openai-codex device-code fallback) from fresh errors.
function fail(reason: string): never {
  process.stderr.write(`Login failed: ${reason}\n`);
  process.exitCode = 1;
  throw new LoginFailedError(reason);
}

export async function apiKeyLogin(prompt: string): Promise<string> {
  const answer = (await promptLine(`${prompt}: `)).trim();
  if (!answer) fail("empty API key");
  return answer;
}

function openBrowser(url: string): void {
  const args =
    process.platform === "win32" ? ["/c", "start", "", url] : process.platform === "darwin" ? [url] : [url];
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  execFile(cmd, args, () => {});
}

function waitForBrowserCode(port: number, host: string, state: string, url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const done = (code: number, body: string) => {
        res.writeHead(code, { "Content-Type": "text/html" });
        res.end(body);
      };
      const u = new URL(req.url ?? "/", "http://x");
      if (u.searchParams.get("state") !== state) {
        done(400, "<p>State mismatch — retry login.</p>");
        return;
      }
      const providerError = u.searchParams.get("error");
      if (providerError) {
        done(400, `<p>Login failed: ${providerError}</p>`);
        cleanup();
        reject(new Error(providerError));
        return;
      }
      const code = u.searchParams.get("code");
      if (!code) {
        done(400, "<p>Missing code — retry login.</p>");
        return;
      }
      done(200, "<p>Login complete — return to the terminal.</p>");
      cleanup();
      resolve(code);
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timed out waiting for browser callback (5 min)"));
    }, CALLBACK_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      server.close();
    };
    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    server.listen(port, host, () => {
      console.log(`Open this URL in your browser:\n${url}`);
      openBrowser(url);
    });
  });
}

function parsePastedCode(input: string): string {
  const t = input.trim();
  if (!t) fail("empty code");
  const m = t.match(/[?&]code=([^&\s]+)/);
  const code = m?.[1] ? decodeURIComponent(m[1]) : (t.split(/\s+/)[0] ?? "");
  if (!code) fail("empty code");
  return code;
}

interface TokenEndpoint {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
}

async function exchangeAuthCode(
  endpoint: TokenEndpoint,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<LoginResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: endpoint.clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  if (endpoint.clientSecret) body.set("client_secret", endpoint.clientSecret);
  let res: Response;
  try {
    res = await fetch(endpoint.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    fail(`token exchange request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) fail(`token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as Record<string, unknown>;
  const access = typeof data.access_token === "string" ? data.access_token : undefined;
  if (!access) fail("token response missing access_token");
  const refresh = typeof data.refresh_token === "string" ? data.refresh_token : undefined;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : undefined;
  const idToken = typeof data.id_token === "string" ? data.id_token : undefined;
  const result: LoginResult = { access };
  if (refresh) result.refresh = refresh;
  if (expiresIn !== undefined) result.expiresAtMs = Date.now() + expiresIn * 1000;
  const email = await bestEffortEmail(endpoint.tokenUrl, access, idToken);
  if (email) result.email = email;
  return result;
}

// Email enrichment only; never fails the login (userinfo/JWT shapes vary).
async function bestEffortEmail(
  tokenUrl: string,
  access: string,
  idToken: string | undefined,
): Promise<string | undefined> {
  try {
    if (tokenUrl.includes("googleapis")) {
      const r = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
        headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
      if (!r.ok) return undefined;
      const j = (await r.json()) as Record<string, unknown>;
      return typeof j.email === "string" ? j.email : undefined;
    }
    const parts = idToken ? idToken.split(".") : access.split(".");
    if (parts.length !== 3) return undefined;
    const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString()) as Record<string, unknown>;
    return typeof payload.email === "string" ? payload.email : undefined;
  } catch {
    return undefined;
  }
}

export async function oauthCodeLogin(def: OAuthCodeLoginDef): Promise<LoginResult> {
  // PKCE S256 (RFC 7636): 96 random bytes → base64url verifier,
  // sha256+base64url challenge (omp `generatePKCE`).
  const verifier = randomBytes(96).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const redirectUri = def.redirectUri ?? `http://127.0.0.1:${def.callbackPort}${def.callbackPath ?? "/oauth-callback"}`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: def.clientId,
    redirect_uri: redirectUri,
    scope: def.scopes.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    ...def.extraAuthorizeParams,
  });
  const url = `${def.authorizeUrl}?${params.toString()}`;

  let code: string;
  try {
    code = await waitForBrowserCode(def.callbackPort, new URL(redirectUri).hostname, state, url);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") {
      fail(err instanceof Error ? err.message : String(err));
    }
    // Occupied loopback port → pasted-code flow (omp `pasteCode` equivalent).
    console.log(`Port ${def.callbackPort} is busy; finish sign-in in your browser, then paste the code.`);
    console.log(url);
    code = parsePastedCode(await promptLine("Paste the code (or full redirect URL): "));
  }
  try {
    return await exchangeAuthCode(def, code, verifier, redirectUri);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
}

// openai-codex headless flow (omp `loginOpenAICodexDevice`): non-standard
// device endpoints — POST usercode, poll token with device_auth_id,
// 403/404 = pending — then the normal PKCE code exchange.
async function loginOpenAICodexDevice(def: DeviceCodeLoginDef): Promise<LoginResult> {
  let initRes: Response;
  try {
    initRes = await fetch(def.deviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: def.clientId }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    fail(`device authorization request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!initRes.ok) fail(`device authorization failed: ${initRes.status}`);
  const init = (await initRes.json()) as { device_auth_id?: string; user_code?: string; interval?: string | number };
  if (!init.device_auth_id || !init.user_code) fail("device authorization response missing fields");
  const pollIntervalMs = (Number.parseInt(String(init.interval ?? "5"), 10) || 5) * 1000 + 3000;
  console.log(`Open https://auth.openai.com/codex/device and enter code: ${init.user_code}`);
  for (let poll = 0; poll < 120; poll++) {
    await new Promise<void>((r) => setTimeout(r, poll === 0 ? Math.min(pollIntervalMs, 5000) : pollIntervalMs));
    const pollRes = await fetch(def.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_auth_id: init.device_auth_id, user_code: init.user_code }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (pollRes.status === 403 || pollRes.status === 404) continue;
    if (!pollRes.ok) fail(`device polling failed: ${pollRes.status}`);
    const data = (await pollRes.json()) as { authorization_code?: string; code_verifier?: string };
    if (!data.authorization_code || !data.code_verifier) fail("device response missing authorization_code");
    try {
      return await exchangeAuthCode(
        { tokenUrl: "https://auth.openai.com/oauth/token", clientId: def.clientId },
        data.authorization_code,
        data.code_verifier,
        "https://auth.openai.com/deviceauth/callback",
      );
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  }
  fail("device authorization timed out — user did not complete login in time");
}

export async function deviceCodeLogin(def: DeviceCodeLoginDef): Promise<LoginResult> {
  if (def.deviceUrl.includes("deviceauth/usercode")) return loginOpenAICodexDevice(def);
  // Standard RFC 8628 device flow: POST device auth, poll per interval, honor expires_in.
  let initRes: Response;
  try {
    initRes = await fetch(def.deviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: def.clientId }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
  } catch (err) {
    fail(`device authorization request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!initRes.ok) fail(`device authorization failed: ${initRes.status}`);
  const init = (await initRes.json()) as Record<string, unknown>;
  const deviceCode = typeof init.device_code === "string" ? init.device_code : undefined;
  const userCode = typeof init.user_code === "string" ? init.user_code : undefined;
  const verificationUri =
    typeof init.verification_uri_complete === "string"
      ? init.verification_uri_complete
      : typeof init.verification_uri === "string"
        ? init.verification_uri
        : undefined;
  if (!deviceCode || !userCode || !verificationUri) fail("device authorization response missing fields");
  const expiresIn = typeof init.expires_in === "number" ? init.expires_in : 1800;
  let intervalMs = Math.max(1000, (typeof init.interval === "number" ? init.interval : 5) * 1000);
  console.log(`Open ${verificationUri} and enter code: ${userCode}`);
  const deadline = Date.now() + expiresIn * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
    const pollRes = await fetch(def.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: def.clientId,
      }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (pollRes.ok) {
      const data = (await pollRes.json()) as Record<string, unknown>;
      const access = typeof data.access_token === "string" ? data.access_token : undefined;
      if (!access) fail("device token response missing access_token");
      const result: LoginResult = { access };
      if (typeof data.refresh_token === "string") result.refresh = data.refresh_token;
      if (typeof data.expires_in === "number") result.expiresAtMs = Date.now() + data.expires_in * 1000;
      return result;
    }
    let errorCode = "";
    try {
      errorCode = String(((await pollRes.json()) as Record<string, unknown>).error ?? "");
    } catch {
      errorCode = "";
    }
    if (errorCode === "authorization_pending") continue;
    if (errorCode === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    fail(`device polling failed: ${pollRes.status} ${errorCode}`.trim());
  }
  fail("device flow timed out");
}
