/** API-key login engine (Step 2).
 * OMP `engine/api-key.ts` (`createApiKeyLogin`) semantics plus the
 * `registry/api-key-validation.ts` probes, adapted to the Rig login roster
 * (`RigLoginProviderDef`) and dependency-free (global fetch). Adds OMP's
 * `optional`/`tolerate-model-denied` KDL validation flags.
 */

import type { RigLoginProviderDef, RigLoginValidation } from "../provider-login-registry.js";

export interface RigLoginPrompt {
  readonly message: string;
  readonly placeholder?: string;
  readonly allowEmpty?: boolean;
}

export interface RigLoginController {
  readonly onAuth?: (info: { url: string; instructions: string }) => void;
  readonly onPrompt?: (prompt: RigLoginPrompt) => Promise<string>;
  readonly onProgress?: (message: string) => void;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

export class RigLoginCancelledError extends Error {
  readonly code = "LOGIN_CANCELLED";
  constructor(message = "Login cancelled") {
    super(message);
    this.name = "RigLoginCancelledError";
  }
}

export class RigApiKeyRequiredError extends Error {
  readonly code = "API_KEY_REQUIRED";
  constructor(message = "API key is required") {
    super(message);
    this.name = "RigApiKeyRequiredError";
  }
}

export class RigApiKeyValidationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, status: number, code = "API_KEY_VALIDATION_FAILED") {
    super(message);
    this.name = "RigApiKeyValidationError";
    this.status = status;
    this.code = code;
  }
}

const VALIDATION_TIMEOUT_MS = 15_000;

function timeoutSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(VALIDATION_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readValidationBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

/** GET probe (OMP `validateApiKeyAgainstModelsEndpoint`). */
export async function validateApiKeyAgainstModelsEndpoint(options: {
  provider: string;
  apiKey: string;
  modelsUrl: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(options.modelsUrl, {
    method: "GET",
    headers: {
      ...(options.headers ?? {}),
      Authorization: `Bearer ${options.apiKey}`,
    },
    signal: timeoutSignal(options.signal),
  });
  if (response.ok) return;
  const details = await readValidationBody(response);
  throw new RigApiKeyValidationError(
    details
      ? `${options.provider} API key validation failed (${response.status}): ${details}`
      : `${options.provider} API key validation failed (${response.status})`,
    response.status,
  );
}

/** Minimal chat-completions probe (OMP `validateOpenAICompatibleApiKey`). */
export async function validateOpenAICompatibleApiKey(options: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  tolerateModelDenied?: boolean;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      temperature: 0,
    }),
    signal: timeoutSignal(options.signal),
  });
  if (response.ok) return;
  if (options.tolerateModelDenied && response.status === 401) {
    try {
      const envelope = JSON.parse(await readValidationBody(response)) as { code?: unknown };
      if (envelope.code === "invalid_model") return;
    } catch {
      // Fall through to the validation error below.
    }
  }
  const details = await readValidationBody(response);
  throw new RigApiKeyValidationError(
    details
      ? `${options.provider} API key validation failed (${response.status}): ${details}`
      : `${options.provider} API key validation failed (${response.status})`,
    response.status,
  );
}

/** Minimal messages probe (OMP `validateAnthropicCompatibleApiKey`). */
export async function validateAnthropicCompatibleApiKey(options: {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const trimmed = options.baseUrl.trim().replace(/\/+$/, "");
  const base = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
  const response = await fetchImpl(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": options.apiKey,
    },
    body: JSON.stringify({
      model: options.model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
    }),
    signal: timeoutSignal(options.signal),
  });
  if (response.ok) return;
  const details = await readValidationBody(response);
  throw new RigApiKeyValidationError(
    details
      ? `${options.provider} API key validation failed (${response.status}): ${details}`
      : `${options.provider} API key validation failed (${response.status})`,
    response.status,
  );
}

async function runValidation(
  validate: RigLoginValidation,
  label: string,
  apiKey: string,
  options: RigLoginController,
): Promise<void> {
  const provider = validate.label ?? label;
  switch (validate.kind) {
    case "chat-completions":
      if (!validate.baseUrl || !validate.model) {
        throw new RigApiKeyValidationError(`${provider} API key validation is misconfigured`, 500);
      }
      try {
        await validateOpenAICompatibleApiKey({
          provider,
          apiKey,
          baseUrl: validate.baseUrl,
          model: validate.model,
          ...(validate.tolerateModelDenied ? { tolerateModelDenied: true } : {}),
          signal: options.signal,
          fetch: options.fetch,
        });
      } catch (error) {
        if (!validate.optional) throw error;
        options.onProgress?.("Validation unavailable; keeping the supplied key.");
      }
      return;
    case "anthropic-messages":
      if (!validate.baseUrl || !validate.model) {
        throw new RigApiKeyValidationError(`${provider} API key validation is misconfigured`, 500);
      }
      try {
        await validateAnthropicCompatibleApiKey({
          provider,
          apiKey,
          baseUrl: validate.baseUrl,
          model: validate.model,
          signal: options.signal,
          fetch: options.fetch,
        });
      } catch (error) {
        if (!validate.optional) throw error;
        options.onProgress?.("Validation unavailable; keeping the supplied key.");
      }
      return;
    case "models-endpoint":
      if (!validate.url) {
        throw new RigApiKeyValidationError(`${provider} API key validation is misconfigured`, 500);
      }
      try {
        await validateApiKeyAgainstModelsEndpoint({
          provider,
          apiKey,
          modelsUrl: validate.url,
          signal: options.signal,
          fetch: options.fetch,
        });
      } catch (error) {
        if (!validate.optional) throw error;
        options.onProgress?.("Validation unavailable; keeping the supplied key.");
      }
      return;
  }
}

/**
 * OMP `createApiKeyLogin` semantics: open key page, masked prompt, strip-bearer
 * normalize, empty-fallback (local no-auth), then validate probe before accept.
 * Validation failure aborts; never stores unvalidated keys except empty-fallback.
 */
export async function runApiKeyLogin(
  def: RigLoginProviderDef,
  options: RigLoginController,
): Promise<string> {
  if (!options.onPrompt) throw new RigApiKeyRequiredError(`${def.name} login needs a prompt`);
  if (def.authUrl && def.instructions) {
    options.onAuth?.({ url: def.authUrl, instructions: def.instructions });
  }
  const answer = await options.onPrompt({
    message: def.prompt ?? `Paste your ${def.name} API key`,
    ...(def.placeholder ? { placeholder: def.placeholder } : {}),
    ...(def.emptyFallback !== undefined ? { allowEmpty: true } : {}),
  });
  if (options.signal?.aborted) throw new RigLoginCancelledError();
  let trimmed = answer.trim();
  if (def.normalize === "strip-bearer" && trimmed) {
    trimmed = trimmed.replace(/^bearer\b\s*/i, "");
    if (!trimmed) {
      throw new RigApiKeyRequiredError(`${def.name} API key is empty after stripping Bearer prefix`);
    }
  }
  if (!trimmed) {
    if (def.emptyFallback !== undefined) return def.emptyFallback;
    throw new RigApiKeyRequiredError();
  }
  if (def.validate) {
    options.onProgress?.("Validating API key...");
    await runValidation(def.validate, def.name, trimmed, options);
  }
  return trimmed;
}
