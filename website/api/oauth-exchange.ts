// Vercel Serverless Function: Google OAuth code exchange proxy.
//
// The Google OAuth client secrets live ONLY in Vercel env vars (never in
// git — GitHub push protection blocks them). The CLI POSTs the one-time
// authorization code here; this function adds client_secret server-side and
// forwards to oauth2.googleapis.com/token.
//
// Deploy: file lives at website/api/ (project Root Directory is `website`).
// Env: GOOGLE_ANTIGRAVITY_CLIENT_SECRET, GOOGLE_GEMINI_CLI_CLIENT_SECRET.

const PROVIDERS = {
  "google-antigravity": {
    clientId:
      "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
    secretEnv: "GOOGLE_ANTIGRAVITY_CLIENT_SECRET",
  },
  "google-gemini-cli": {
    clientId:
      "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    secretEnv: "GOOGLE_GEMINI_CLI_CLIENT_SECRET",
  },
} as const;

type ProviderId = keyof typeof PROVIDERS;

interface VercelResponse {
  status(statusCode: number): VercelResponse;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

function json(res: VercelResponse, status: number, body: unknown): void {
  res.status(status).setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

interface VercelRequest {
  method?: string;
  body?: unknown;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "method_not_allowed" });
  }
  let payload: Record<string, unknown>;
  try {
    payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return json(res, 400, { error: "invalid_request", error_description: "Body must be JSON." });
  }
  const provider = payload["provider"];
  const code = payload["code"];
  const codeVerifier = payload["code_verifier"];
  const redirectUri = payload["redirect_uri"];
  if (
    typeof provider !== "string" ||
    !(provider in PROVIDERS) ||
    typeof code !== "string" ||
    !code ||
    typeof codeVerifier !== "string" ||
    !codeVerifier ||
    typeof redirectUri !== "string" ||
    !redirectUri
  ) {
    return json(res, 400, {
      error: "invalid_request",
      error_description: "provider, code, code_verifier and redirect_uri are required.",
    });
  }
  const config = PROVIDERS[provider as ProviderId];
  const clientSecret = process.env[config.secretEnv];
  if (!clientSecret) {
    return json(res, 500, {
      error: "server_error",
      error_description: "OAuth proxy is not configured for this provider.",
    });
  }
  let tokenResponse: Response;
  try {
    tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: config.clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
      }).toString(),
    });
  } catch (error) {
    return json(res, 502, {
      error: "server_error",
      error_description: `Token endpoint unreachable: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const text = await tokenResponse.text().catch(() => "");
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    return json(res, 502, {
      error: "server_error",
      error_description: "Token endpoint returned invalid JSON.",
    });
  }
  if (!tokenResponse.ok) {
    const description =
      parsed && typeof parsed === "object" && "error_description" in parsed
        ? String((parsed as Record<string, unknown>)["error_description"])
        : text.slice(0, 300);
    return json(res, tokenResponse.status, {
      error: "exchange_failed",
      error_description: description,
    });
  }
  return json(res, 200, parsed);
}
