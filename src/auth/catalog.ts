export interface ApiKeyLoginDef {
  kind: "api-key";
  instructions: string;
  authUrl?: string;
  prompt?: string;
}

export interface OAuthCodeLoginDef {
  kind: "oauth-code";
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientId: string;
  clientSecret?: string;
  callbackPort: number;
  callbackPath?: string;
  redirectUri?: string;
  extraAuthorizeParams?: Record<string, string>;
}

export interface DeviceCodeLoginDef {
  kind: "device-code";
  deviceUrl: string;
  tokenUrl: string;
  clientId: string;
}

export interface LoginProvider {
  id: string;
  name: string;
  login: ApiKeyLoginDef | OAuthCodeLoginDef | DeviceCodeLoginDef;
  // openai-codex only: headless device-code fallback when port 1455 is busy
  // or the browser callback fails.
  deviceFallback?: DeviceCodeLoginDef;
}

// Desktop-app client IDs come from env only (never committed):
// RIG_GOOGLE_CLIENT_ID, RIG_GOOGLE_CLIENT_SECRET, RIG_CODEX_CLIENT_ID.
// Providers without credentials are omitted from the login list; `runLogin`
// prints setup guidance for them.
function googleProvider(): LoginProvider | undefined {
  const clientId = process.env.RIG_GOOGLE_CLIENT_ID;
  if (!clientId) return undefined;
  const login: OAuthCodeLoginDef = {
    kind: "oauth-code",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    clientId,
    callbackPort: 51121,
    callbackPath: "/oauth-callback",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
  };
  const secret = process.env.RIG_GOOGLE_CLIENT_SECRET;
  if (secret !== undefined) login.clientSecret = secret;
  return { id: "google-antigravity", name: "Antigravity (Gemini 3, Claude, GPT-OSS)", login };
}

function codexProvider(): LoginProvider | undefined {
  const clientId = process.env.RIG_CODEX_CLIENT_ID;
  if (!clientId) return undefined;
  return {
    id: "openai-codex",
    name: "ChatGPT Plus/Pro (Codex Subscription)",
    login: {
      kind: "oauth-code",
      authorizeUrl: "https://auth.openai.com/oauth/authorize",
      tokenUrl: "https://auth.openai.com/oauth/token",
      scopes: [
        "openid",
        "profile",
        "email",
        "offline_access",
        "api.connectors.read",
        "api.connectors.invoke",
      ],
      clientId,
      callbackPort: 1455,
      callbackPath: "/auth/callback",
      redirectUri: "http://localhost:1455/auth/callback",
      extraAuthorizeParams: {
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "rig",
      },
    },
    deviceFallback: {
      kind: "device-code",
      deviceUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
      tokenUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
      clientId,
    },
  };
}

// Bundled login providers with their OAuth/API-key parameters.
export const LOGIN_PROVIDERS: LoginProvider[] = [
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    login: {
      kind: "api-key",
      instructions: "Log in to the OpenCode Zen console and copy your OpenCode Zen API key",
      authUrl: "https://opencode.ai/auth",
      prompt: "Paste your OpenCode Zen API key",
    },
  },
  ...[googleProvider(), codexProvider()].filter((p): p is LoginProvider => p !== undefined),
];

const SETUP_HINTS: Record<string, string> = {
  "google-antigravity": "set RIG_GOOGLE_CLIENT_ID (and RIG_GOOGLE_CLIENT_SECRET) to enable this login",
  "openai-codex": "set RIG_CODEX_CLIENT_ID to enable this login",
};

export function setupHint(id: string): string | undefined {
  return SETUP_HINTS[id];
}
