import { describe, expect, it, vi } from "vitest";

import {
  buildOAuthExchangeBody,
  resolveOAuthClientSecret,
} from "../../src/login/engines/oauth-login.js";
import {
  resolveOAuthExchangeProxyUrl,
} from "../../src/login/run-provider-login.js";

function defWithEnv(env?: string) {
  return {
    id: "google-antigravity",
    name: "Antigravity",
    kind: "oauth-code" as const,
    clientId: "test-client-id",
    ...(env ? { clientSecretEnv: env } : {}),
  };
}

describe("resolveOAuthClientSecret", () => {
  it("returns undefined without clientSecretEnv", () => {
    expect(resolveOAuthClientSecret(defWithEnv())).toBeUndefined();
  });

  it("reads the named env var", () => {
    process.env.RIG_TEST_OAUTH_SECRET = "s3cr3t";
    try {
      expect(resolveOAuthClientSecret(defWithEnv("RIG_TEST_OAUTH_SECRET"))).toBe("s3cr3t");
    } finally {
      delete process.env.RIG_TEST_OAUTH_SECRET;
    }
  });

  it("treats empty env as unset", () => {
    process.env.RIG_TEST_OAUTH_SECRET = "";
    try {
      expect(resolveOAuthClientSecret(defWithEnv("RIG_TEST_OAUTH_SECRET"))).toBeUndefined();
    } finally {
      delete process.env.RIG_TEST_OAUTH_SECRET;
    }
  });
});

describe("buildOAuthExchangeBody", () => {
  const params = { code: "code-1", verifier: "verifier-1", redirectUri: "http://localhost:51121/oauth-callback" };

  it("omits client_secret without a secret", () => {
    const body = buildOAuthExchangeBody(defWithEnv(), params);
    expect(body).toEqual({
      grant_type: "authorization_code",
      code: "code-1",
      redirect_uri: "http://localhost:51121/oauth-callback",
      client_id: "test-client-id",
      code_verifier: "verifier-1",
    });
    // URL-encodes cleanly (what exchangeOAuthCode POSTs).
    expect(new URLSearchParams(body).get("client_secret")).toBeNull();
  });

  it("includes client_secret when set", () => {
    const body = buildOAuthExchangeBody(defWithEnv("X"), params, "s3cr3t");
    expect(body["client_secret"]).toBe("s3cr3t");
    expect(new URLSearchParams(body).get("client_secret")).toBe("s3cr3t");
  });
});

describe("resolveOAuthExchangeProxyUrl", () => {
  it("defaults to the Vercel proxy", () => {
    delete process.env.RIG_OAUTH_EXCHANGE_PROXY_URL;
    expect(resolveOAuthExchangeProxyUrl()).toBe("https://rig-cli.vercel.app/api/oauth-exchange");
  });

  it("honors the override", () => {
    process.env.RIG_OAUTH_EXCHANGE_PROXY_URL = "http://localhost:3000/api/oauth-exchange";
    try {
      expect(resolveOAuthExchangeProxyUrl()).toBe("http://localhost:3000/api/oauth-exchange");
    } finally {
      delete process.env.RIG_OAUTH_EXCHANGE_PROXY_URL;
    }
  });
});
