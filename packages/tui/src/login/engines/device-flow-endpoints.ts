/** Per-provider OAuth endpoint parameters (Step 2 supplement).
 * Static transcription of the token/device URLs + POST bodies each OAuth row
 * needs. Only providers whose generic flow is wired below appear here; the
 * rest keep manual hookId rows until their exact exchange is verified.
 */

export interface RigOAuthEndpointParams {
  /** Token endpoint URL. */
  readonly tokenUrl: string;
  /** Extra device-authorization params (device flow only). */
  readonly extraDeviceParams?: Record<string, string>;
  /** Body builder for the authorization-code exchange (default: standard form). */
  readonly exchangeBody?: (params: {
    readonly code: string;
    readonly verifier: string;
    readonly redirectUri: string;
  }) => Record<string, string>;
}

const ENDPOINTS: Record<string, RigOAuthEndpointParams> = {
  // OMP openai-codex.kdl: form token exchange at auth.openai.com.
  "openai-codex": { tokenUrl: "https://auth.openai.com/oauth/token" },
  // OMP devin.kdl: JSON token exchange, standard=#false + code_verifier param.
  devin: {
    tokenUrl: "https://api.devin.ai/auth/cli/token",
    exchangeBody: ({ code, verifier }) => ({ code, code_verifier: verifier }),
  },
  // OMP gitlab-duo.kdl / gitlab-duo-agent.kdl: standard form exchange.
  "gitlab-duo": { tokenUrl: "https://gitlab.com/oauth/token" },
  "gitlab-duo-agent": { tokenUrl: "https://gitlab.com/oauth/token" },
  // OMP google-*.kdl: standard form exchange at oauth2.googleapis.com.
  "google-antigravity": { tokenUrl: "https://oauth2.googleapis.com/token" },
  "google-gemini-cli": { tokenUrl: "https://oauth2.googleapis.com/token" },
  // OMP kimi-code.kdl: device flow at the regional auth host.
  "kimi-code": {
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    extraDeviceParams: { device_url: "https://auth.kimi.com/api/oauth/device_authorization" },
  },
  // OMP muse-code.kdl: device flow at Meta OIDC endpoints.
  "muse-code": {
    tokenUrl: "https://auth.meta.com/oidc/device/token/",
    extraDeviceParams: { device_url: "https://auth.meta.com/oidc/device/authorization/" },
  },
  // OMP xai-oauth.kdl: device flow at auth.x.ai.
  "xai-oauth": {
    tokenUrl: "https://auth.x.ai/oauth2/token",
    extraDeviceParams: { device_url: "https://auth.x.ai/oauth2/device/code" },
  },
  // OMP openrouter.kdl: JSON key-mint exchange; stored as a durable API key.
  openrouter: {
    tokenUrl: "https://openrouter.ai/api/v1/auth/keys",
    exchangeBody: ({ code, verifier }) => ({
      code,
      code_verifier: verifier,
      code_challenge_method: "S256",
    }),
  },
};

export function getRigOAuthEndpoints(providerId: string): RigOAuthEndpointParams | undefined {
  return ENDPOINTS[providerId];
}
