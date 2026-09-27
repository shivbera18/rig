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
  // openai-codex only: headless fallback when port 1455 is busy or the
  // browser callback 403s (omp `loginOpenAICodexDevice`).
  deviceFallback?: DeviceCodeLoginDef;
}

// Values read from oh-my-pi KDL + oauth sources at implementation time:
// - opencode-zen: packages/catalog/src/compat/rules/auth/opencode-zen.kdl
// - google-antigravity: .../auth/google-antigravity.kdl (client-id/secret
//   base64-decoded from the KDL into the plain strings below)
// - openai-codex: .../auth/openai-codex.kdl (oauth-code, port 1455) +
//   packages/ai/src/registry/oauth/openai-codex.ts (DEVICE_* URLs, CLIENT_ID,
//   SCOPE); device flow: packages/ai/src/registry/oauth/openai-codex.ts
//   `loginOpenAICodexDevice`. Refresh/client details live in step 4.
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
  {
    id: "google-antigravity",
    name: "Antigravity (Gemini 3, Claude, GPT-OSS)",
    login: {
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
      clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
      clientSecret: "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",
      callbackPort: 51121,
      callbackPath: "/oauth-callback",
      extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
    },
  },
  {
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
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      callbackPort: 1455,
      callbackPath: "/auth/callback",
      redirectUri: "http://localhost:1455/auth/callback",
      extraAuthorizeParams: {
        id_token_add_organizations: "true",
        codex_cli_simplified_flow: "true",
        originator: "omp",
      },
    },
    deviceFallback: {
      kind: "device-code",
      deviceUrl: "https://auth.openai.com/api/accounts/deviceauth/usercode",
      tokenUrl: "https://auth.openai.com/api/accounts/deviceauth/token",
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    },
  },
];
