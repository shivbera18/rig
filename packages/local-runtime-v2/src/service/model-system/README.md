# Model System

Model System is the model owner of Local Runtime v2. It simultaneously maintains two sets of capabilities:

- resolution: resolves process configuration, authentication context, and Agent model references into `LLMModelConfig` used by the Agent runner;
- provider management: manages BYOK Provider configuration, model catalogs, connectivity, caching, and OAuth state.

Both capability sets share model identity, request addresses, request headers, thinking protocol, and the same profile configuration port. `initializeModelSystem` creates the single resolver and assembles resolution and management into the same process-level owner. Turn preparation receives this resolver, and `ModelProviderApplication` is assembled after Session creation. Turn admission, HTTP DTO mapping, AgentHost lifecycle, and Session persistence remain held by their respective boundaries.

When OpenRouter uses the official `https://openrouter.ai` endpoint, Model System uniformly includes Rig's app attribution headers in actual inference, connection testing, and model discovery requests: `HTTP-Referer`, `X-OpenRouter-Title`, and `X-OpenRouter-Categories`. These product identity fields are overridden case-insensitively by Runtime over header names, and user-defined Provider headers cannot alter attribution identity; other endpoints are unaffected.

Official OpenCode Go HTTPS endpoints under `https://opencode.ai/zen/go` and its subpaths automatically receive `x-opencode-session` and `User-Agent: Rig`, without relying on custom Provider names. Inference requests use the Session ID provided by Runtime, which remains stable across turns, resumption, and retries within the same session while being isolated across different sessions; titles and compaction reuse resolved request headers. Connection tests and model discovery do not belong to a product session and use independently generated probe IDs. These two identity fields override static configuration case-insensitively by header name, while other headers remain intact. Standard Zen `/zen/v1`, proxy addresses, and other Providers do not automatically apply this policy.

## Table of Contents

- `contracts.ts`: shared configuration read model, resolution, and Provider capability contract;
- `identity.ts`: unique identity definitions for Provider ID, source, and API protocol;
- `initialize.ts`: binds the profile config port and assembles the process-level Model System owner;
- `resolution/`: Provider, BYOK, model ref, thinking, and credential resolution;
- `catalog/`: model list, Provider view, caching, and selection;
- `connectivity/`: Provider request rules, model discovery, and connection testing;
- `management/`: Provider configuration changes and Rig Context workflow;
- `codex-oauth.ts`: Codex OAuth login status;
- `index.ts`: single public entry point, re-exports only.

Other services' production code only imports from `service/model-system/index.ts`. Current AgentHost preparation consumes resolution capability, while ModelProvider Controller and Session Application consume management capability from the same owner. V1 follows the existing implementation and continues to be retired as planned; this directory does not carry V1 compatibility responsibilities.

## Codex OAuth Login

`CodexOAuthManager.startLogin({ method })` supports `browser` (default) and `device_code`, reusing vendored Pi's OAuth implementation and host `fetch`. The TUI selects methods, queries status, and cancels logins through process-local capabilities; the HTTP entry point defaults to browser login.

Runtime holds the currently logged-in `loginId`, authorization URL, and device code in memory. Device code expiration uses Unix ms; this temporary data is not written to configuration. Repeated requests using the same method reuse the active authorization; switching methods requires cancellation first. `cancelLogin(loginId)` only cancels the corresponding attempt to prevent expired panels from affecting new logins.

Credentials are first stored in this authorization's in-memory storage, and written to the active profile's `codex-auth.json` only after confirming no cancellation occurred. Cancellation and timeouts halt authorization requests and prevent late results from configuring models. The device code page is displayed by the TUI, while account tokens remain in Runtime.

## BYOK Model Discovery

Anthropic Messages providers first request `<base>/v1/models`. Only a 404 or 405 triggers fallback to `<base>/models`, then discovery records the working path for subsequent refreshes. Headers with case-insensitive `Authorization` or `x-api-key` are treated as already authenticated; when missing, the configured API key is added. Other API formats use their standard paths.

Official OpenCode Go HTTPS endpoints under `https://opencode.ai/zen/go` receive `x-opencode-session` and `User-Agent: Rig` headers.

## Codex OAuth Model Discovery

After login completes, `CodexOAuthManager` retrieves credentials from the active profile's `codex-auth.json`, reuses `AuthStorage`'s refresh mechanism and host `fetch`, and requests `https://chatgpt.com/backend-api/codex/models?client_version=0.153.0`. `connectivity/codex-model-discovery.ts` handles this independent Codex protocol. The compatible version comes from the verified Codex client protocol, independent of the Rig product version; model IDs and thinking levels are provided by the response. OAuth resolution reuses configurable thinking protocols, mapping remote levels directly to requests; newly added levels such as `ultra` do not depend on Pi's static level enum.

Only models with `visibility=list` are imported; ChatGPT OAuth does not filter using `supported_in_api`. Model names, thinking options, and input types come from the response. Default context is taken from `context_window`, falling back to `max_context_window` when missing; only when the remote provides the maximum configurable window is that value used for initialization. Output limits follow existing configuration, and new models use Runtime's general defaults.

Model listings are merged by ID, preserving existing order and appending newly discovered models. Saved fields have highest priority; nested `limit.context`, `limit.output`, `thinking.effortOptions`, and `modalities.input/output` are merged separately. User-configured names, enabled states, default models, and other settings are preserved. Fields automatically written by older versions without edit history are also preserved as local config. Merging reads latest values within config transactions, preventing overwriting user changes made during refresh.

Initial OAuth completion automatically fetches model listings; subsequent manual updates occur via "Refresh model list" in model settings. Opening settings triggers a GET OAuth status request to read state only, while POST `/rig/api/provider-auth/openai-codex/models` executes model discovery; there is no scheduled refresh or throttling, and concurrent discovery requests share execution. A loading state is shown during fetching, and failure allows immediate retry. Existing provider configurations serve as the last successful persisted state: refresh failure preserves configuration, and initial discovery failure preserves credentials for retry. Remote timeouts, error responses, or empty listings do not overwrite existing configurations with static lists.

After deleting a provider, status queries retain the deletion result; deleting credentials or providers during refresh also aborts saving. After manually deleting a single model, subsequent remote discovery can re-add that model; use the model enable toggle to keep it persistently hidden.
