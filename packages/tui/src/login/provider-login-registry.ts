/** Rig multi-provider login roster (Step 1).
 * Transcribed verbatim from oh-my-pi/packages/catalog/src/compat/rules/auth/*.kdl
 * plus roster order from auth/_order.kdl. `rig` entry preserves the legacy
 * Rig Token Plan region flow (cn/en); `openai` (env-only, no login) is skipped.
 * Static TS table by design: no KDL parser is ported (smaller diff).
 */

export type RigLoginKind = "rig-managed" | "api-key" | "oauth-code" | "device-code" | "custom";

export interface RigLoginValidation {
  readonly kind: "models-endpoint" | "chat-completions" | "anthropic-messages";
  readonly label?: string;
  readonly url?: string;
  readonly baseUrl?: string;
  readonly model?: string;
  /** Key valid even when the probe model is denied (nvidia) or probe fails (stepfun). */
  readonly optional?: boolean;
  /** 401 invalid_model still counts as valid key (qianfan). */
  readonly tolerateModelDenied?: boolean;
}

export interface RigLoginProviderDef {
  readonly id: string;
  readonly name: string;
  readonly kind: RigLoginKind;
  readonly authUrl?: string;
  readonly instructions?: string;
  readonly prompt?: string;
  readonly placeholder?: string;
  readonly emptyFallback?: string;
  readonly normalize?: string;
  readonly validate?: RigLoginValidation;
  readonly callbackPort?: number;
  readonly callbackPath?: string;
  readonly authorizeUrl?: string;
  readonly authorizeParams?: Record<string, string>;
  readonly scopes?: readonly string[];
  readonly clientId?: string;
  readonly hookId?: string;
}

export const RIG_LOGIN_PROVIDERS: readonly RigLoginProviderDef[] = [
  { id: "rig", name: "Rig Token Plan", kind: "rig-managed" },
  { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex Subscription)", kind: "oauth-code", instructions: "A browser window should open. Complete login to finish.", authorizeUrl: "https://auth.openai.com/oauth/authorize", authorizeParams: { id_token_add_organizations: "true", codex_cli_simplified_flow: "true", originator: "omp" }, clientId: "app_EMoamEEZ73f0CkXaXp7hrann", callbackPath: "/auth/callback", callbackPort: 1455, portFallback: false, scopes: ["openid", "profile", "email", "offline_access", "api.connectors.read", "api.connectors.invoke"] },
  { id: "anthropic", name: "Anthropic (Claude Pro/Max)", kind: "oauth-code", instructions: "Complete login in your browser. If the browser cannot reach this machine, paste the final redirect URL or authorization code when prompted.", authorizeUrl: "https://claude.ai/oauth/authorize", authorizeParams: { code: "true" }, clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", callbackPath: "/callback", callbackPort: 54545, scopes: ["org:create_api_key", "user:profile", "user:inference", "user:sessions:claude_code", "user:mcp_servers", "user:file_upload"] },
  { id: "zai", name: "Z.AI (GLM Coding Plan)", kind: "api-key", authUrl: "https://z.ai/manage-apikey/apikey-list", instructions: "Copy your API key from the dashboard", prompt: "Paste your Z.AI API key", placeholder: "sk-...", validate: { kind: "chat-completions", label: "Z.AI", url: "https://api.z.ai/api/coding/paas/v4", baseUrl: "https://api.z.ai/api/coding/paas/v4", model: "glm-5.2" } },
  { id: "zai-coding-plan", name: "Z.AI (GLM Coding Plan · Sign in)", kind: "oauth-code", instructions: "Complete Z.ai login in your browser. On supported local desktops, omp captures the zcode:// callback and restores its previous handler automatically. You can also paste the final redirect URL or authorization code when prompted.", authorizeUrl: "https://chat.z.ai/api/oauth/authorize", clientId: "client_P8X5CMWmlaRO9gyO-KSqtg", callbackPort: 0, manualOnly: true },
  { id: "kimi-code", name: "Kimi Code", kind: "device-code", instructions: "Enter code: {user_code}", clientId: "17e5f671-d194-4dfb-9706-5516cb48c098" },
  { id: "openrouter", name: "OpenRouter", kind: "oauth-code", authorizeUrl: "https://openrouter.ai/auth", callbackPath: "/callback", callbackPort: 54549 },
  { id: "github-copilot", name: "GitHub Copilot", kind: "custom", hookId: "github-copilot" },
  { id: "cursor", name: "Cursor (Claude, GPT, etc.)", kind: "custom", hookId: "cursor" },
  { id: "devin", name: "Devin", kind: "oauth-code", instructions: "Sign in to Devin in your browser.", authorizeUrl: "https://app.devin.ai/auth/cli/continue", authorizeParams: { prompt: "select_account" }, callbackPath: "/callback", callbackPort: 59653 },
  { id: "google-antigravity", name: "Antigravity (Gemini 3, Claude, GPT-OSS)", kind: "oauth-code", instructions: "Complete the sign-in in your browser.", authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", clientId: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com", callbackPath: "/oauth-callback", callbackPort: 51121, authorizeParams: { access_type: "offline", prompt: "consent" }, scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile", "https://www.googleapis.com/auth/cclog", "https://www.googleapis.com/auth/experimentsandconfigs"] },
  { id: "google-gemini-cli", name: "Google Cloud Code Assist (Gemini CLI)", kind: "oauth-code", instructions: "Complete the sign-in in your browser.", authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth", clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com", callbackPath: "/oauth2callback", callbackPort: 8085, authorizeParams: { access_type: "offline", prompt: "consent" }, scopes: ["https://www.googleapis.com/auth/cloud-platform", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/userinfo.profile"] },
  { id: "openai-codex-device", name: "ChatGPT Plus/Pro (Codex, headless/device)", kind: "custom", hookId: "openai-codex-device" },
  { id: "xai", name: "xAI API", kind: "api-key", authUrl: "https://console.x.ai/team/default/api-keys", instructions: "Create or copy your API key from the xAI Console", prompt: "Paste your xAI API key", placeholder: "xai-...", validate: { kind: "models-endpoint", label: "xAI", url: "https://api.x.ai/v1/models" } },
  { id: "xai-oauth", name: "xAI Grok OAuth (SuperGrok or X Premium+)", kind: "device-code", instructions: "Enter code: {user_code}", clientId: "b1a00492-073a-47ea-816f-4c329264a828", scopes: ["openid", "profile", "email", "offline_access", "grok-cli:access", "api:access"] },
  { id: "gitlab-duo", name: "GitLab Duo Non-Agentic", kind: "oauth-code", instructions: "Complete GitLab login in browser. If GitLab responds with \"The redirect URI included is not valid\", register your own GitLab OAuth application and set GITLAB_CLIENT_ID + GITLAB_REDIRECT_URI, or use a Personal Access Token via GITLAB_TOKEN.", authorizeUrl: "https://gitlab.com/oauth/authorize", clientId: "da4edff2e6ebd2bc3208611e2768bc1c1dd7be791dc5ff26ca34ca9ee44f7d4b", callbackPath: "/callback", callbackPort: 8080, scopes: ["api"] },
  { id: "gitlab-duo-agent", name: "GitLab Duo Agent", kind: "oauth-code", instructions: "Complete GitLab login in your browser. This uses GitLab's official VS Code OAuth application. If the redirect opens VS Code instead of returning to OMP, copy the full vscode://gitlab.gitlab-workflow/authentication?... callback URL from VS Code/browser and paste it back into OMP.", authorizeUrl: "https://gitlab.com/oauth/authorize", clientId: "36f2a70cddeb5a0889d4fd8295c241b7e9848e89cf9e599d0eed2d8e5350fbf5", callbackPort: 0, manualOnly: true, scopes: ["api"] },
  { id: "alibaba-coding-plan", name: "Alibaba Coding Plan", kind: "custom", hookId: "alibaba-coding-plan" },
  { id: "alibaba-token-plan", name: "QwenCloud Token Plan", kind: "custom", hookId: "alibaba-token-plan" },
  { id: "aiand", name: "ai&", kind: "api-key", authUrl: "https://console.aiand.com/api-keys", instructions: "Copy your API key from the ai& console", prompt: "Paste your ai& API key", placeholder: "sk-...", validate: { kind: "models-endpoint", label: "ai&", url: "https://api.aiand.com/v1/models" } },
  { id: "abliteration", name: "Abliteration", kind: "api-key", authUrl: "https://abliteration.ai/console", instructions: "Copy your API key from the Abliteration console", prompt: "Paste your Abliteration API key", placeholder: "ak_...", validate: { kind: "models-endpoint", url: "https://api.abliteration.ai/v1/models" } },
  { id: "zhipu-coding-plan", name: "Zhipu Coding Plan (智谱)", kind: "api-key", authUrl: "https://bigmodel.cn/coding-plan/personal/overview", instructions: "Copy your API key from the Coding Plan dashboard", prompt: "Paste your Zhipu API key", placeholder: "<id>.<secret>", validate: { kind: "chat-completions", label: "Zhipu", url: "https://open.bigmodel.cn/api/coding/paas/v4", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-5.1" } },
  { id: "umans", name: "Umans AI Coding Plan", kind: "api-key", authUrl: "https://app.umans.ai/billing", instructions: "Create or copy your Umans API key from Dashboard → API Keys.", prompt: "Paste your Umans API key", placeholder: "sk-...", validate: { kind: "anthropic-messages", url: "https://api.code.umans.ai", baseUrl: "https://api.code.umans.ai", model: "umans-coder" } },
  { id: "qwen-portal", name: "Qwen Portal", kind: "api-key", authUrl: "https://chat.qwen.ai", instructions: "Copy your Qwen OAuth token or API key", prompt: "Paste your Qwen OAuth token or API key", placeholder: "sk-...", validate: { kind: "chat-completions", label: "qwen-portal", url: "https://portal.qwen.ai/v1", baseUrl: "https://portal.qwen.ai/v1", model: "coder-model" } },
  { id: "sakana", name: "Sakana AI", kind: "api-key", authUrl: "https://console.sakana.ai/api-keys", instructions: "Copy your API key from the Sakana AI console", prompt: "Paste your Sakana AI API key", placeholder: "sk-...", validate: { kind: "models-endpoint", url: "https://api.sakana.ai/v1/models" } },
  { id: "minimax-code", name: "MiniMax Token Plan (International)", kind: "api-key", authUrl: "https://platform.minimax.io/subscribe/token-plan", instructions: "Subscribe to Token Plan and copy your API key", prompt: "Paste your MiniMax Token Plan API key", placeholder: "sk-...", validate: { kind: "chat-completions", label: "MiniMax Token Plan", url: "https://api.minimax.io/v1", baseUrl: "https://api.minimax.io/v1", model: "MiniMax-M3" } },
  { id: "minimax-code-cn", name: "MiniMax Token Plan (China)", kind: "api-key", authUrl: "https://platform.minimaxi.com/subscribe/token-plan", instructions: "Subscribe to Token Plan and copy your API key", prompt: "Paste your MiniMax Token Plan API key", placeholder: "sk-...", validate: { kind: "chat-completions", url: "https://api.minimaxi.com/v1", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3" } },
  { id: "xiaomi", name: "Xiaomi MiMo", kind: "custom", hookId: "xiaomi" },
  { id: "xiaomi-token-plan-sgp", name: "Xiaomi Token Plan (Singapore)", kind: "api-key", authUrl: "https://platform.xiaomimimo.com/console/plan-manage", instructions: "Copy your token-plan API key for the Singapore region", prompt: "Paste your Xiaomi Token Plan Singapore API key (tp-...)", placeholder: "tp-...", validate: { kind: "chat-completions", label: "xiaomi", url: "https://token-plan-sgp.xiaomimimo.com/v1", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1", model: "mimo-v2.5" } },
  { id: "xiaomi-token-plan-ams", name: "Xiaomi Token Plan (Europe)", kind: "api-key", authUrl: "https://platform.xiaomimimo.com/console/plan-manage", instructions: "Copy your token-plan API key for the Europe region", prompt: "Paste your Xiaomi Token Plan Europe API key (tp-...)", placeholder: "tp-...", validate: { kind: "chat-completions", label: "xiaomi", url: "https://token-plan-ams.xiaomimimo.com/v1", baseUrl: "https://token-plan-ams.xiaomimimo.com/v1", model: "mimo-v2.5" } },
  { id: "xiaomi-token-plan-cn", name: "Xiaomi Token Plan (China)", kind: "api-key", authUrl: "https://platform.xiaomimimo.com/console/plan-manage", instructions: "Copy your token-plan API key for the China region", prompt: "Paste your Xiaomi Token Plan China API key (tp-...)", placeholder: "tp-...", validate: { kind: "chat-completions", label: "xiaomi", url: "https://token-plan-cn.xiaomimimo.com/v1", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1", model: "mimo-v2.5" } },
  { id: "firepass", name: "Fire Pass (Fireworks subscription)", kind: "api-key", authUrl: "https://app.fireworks.ai/settings/users/api-keys", instructions: "Create a dedicated Fire Pass API key in the Fireworks dashboard", prompt: "Paste your Fire Pass API key", placeholder: "fpk_...", validate: { kind: "chat-completions", label: "Fire Pass", url: "https://api.fireworks.ai/inference/v1", baseUrl: "https://api.fireworks.ai/inference/v1", model: "accounts/fireworks/routers/glm-5p2-fast" } },
  { id: "cline-pass", name: "ClinePass", kind: "api-key", authUrl: "https://app.cline.bot/dashboard/account", instructions: "Create an API key in the Cline dashboard under Settings → API Keys", prompt: "Paste your Cline API key", placeholder: "sk_...", validate: { kind: "models-endpoint", label: "ClinePass", url: "https://api.cline.bot/api/v1/users/me" } },
  { id: "commandcode", name: "Command Code", kind: "api-key", authUrl: "https://commandcode.ai/studio", instructions: "Create or copy a Provider API key from Command Code Studio", prompt: "Paste your Command Code API key", placeholder: "user_..." },
  { id: "charm-hyper", name: "Charm Hyper", kind: "api-key", authUrl: "https://hyper.charm.land/", instructions: "Create or copy an API key from the Charm Hyper dashboard", prompt: "Paste your Charm Hyper API key", placeholder: "sk-hyper-...", normalize: "strip-bearer", validate: { kind: "models-endpoint", label: "Charm Hyper", url: "https://hyper.charm.land/v1/credits" } },
  { id: "deepseek", name: "DeepSeek", kind: "api-key", authUrl: "https://platform.deepseek.com/api_keys", instructions: "Create or copy your API key from the DeepSeek dashboard", prompt: "Paste your DeepSeek API key", placeholder: "sk-...", normalize: "strip-bearer", validate: { kind: "models-endpoint", label: "deepseek", url: "https://api.deepseek.com/v1/models" } },
  { id: "stepfun", name: "StepFun", kind: "api-key", authUrl: "https://platform.stepfun.ai/interface-key", instructions: "Copy your API key from the StepFun Open Platform", prompt: "Paste your StepFun API key", placeholder: "...", validate: { kind: "chat-completions", label: "StepFun", url: "https://api.stepfun.ai/v1", baseUrl: "https://api.stepfun.ai/v1", model: "step-5-preview", optional: true } },
  { id: "muse-code", name: "Muse Code (Subscription)", kind: "device-code", instructions: "Enter code: {user_code}", clientId: "1031625952748946" },
  { id: "meta", name: "Meta Model API", kind: "api-key", authUrl: "https://developer.meta.com/ai/", instructions: "Create or copy your key from the Meta Model API dashboard", prompt: "Paste your Meta Model API key", placeholder: "Model API key", validate: { kind: "models-endpoint", url: "https://api.meta.ai/v1/models" } },
  { id: "moonshot", name: "Moonshot (Kimi API)", kind: "api-key", authUrl: "https://platform.moonshot.ai/console/api-keys", instructions: "Copy your API key from the Moonshot dashboard", prompt: "Paste your Moonshot API key", placeholder: "sk-...", validate: { kind: "models-endpoint", label: "moonshot", url: "https://api.moonshot.ai/v1/models" } },
  { id: "cerebras", name: "Cerebras", kind: "api-key", authUrl: "https://cloud.cerebras.ai/platform/", instructions: "Copy your API key from the Cerebras dashboard", prompt: "Paste your Cerebras API key", placeholder: "csk-...", validate: { kind: "chat-completions", label: "Cerebras", url: "https://api.cerebras.ai/v1", baseUrl: "https://api.cerebras.ai/v1", model: "gpt-oss-120b" } },
  { id: "baseten", name: "Baseten", kind: "api-key", authUrl: "https://app.baseten.co/settings/api_keys", instructions: "Copy your API key from the Baseten dashboard", prompt: "Paste your Baseten API key", placeholder: "bt_...", validate: { kind: "models-endpoint", label: "Baseten", url: "https://inference.baseten.co/v1/models" } },
  { id: "fireworks", name: "Fireworks", kind: "api-key", authUrl: "https://app.fireworks.ai/settings/users/api-keys", instructions: "Create or copy your Fireworks API key", prompt: "Paste your Fireworks API key", placeholder: "fw_...", validate: { kind: "models-endpoint", label: "Fireworks", url: "https://api.fireworks.ai/v1/accounts/fireworks/models?filter=supports_serverless%3Dtrue&pageSize=1" } },
  { id: "together", name: "Together", kind: "api-key", authUrl: "https://api.together.xyz/settings/api-keys", instructions: "Copy your API key from the Together dashboard", prompt: "Paste your Together API key", placeholder: "sk-...", validate: { kind: "models-endpoint", label: "together", url: "https://api.together.xyz/v1/models" } },
  { id: "nvidia", name: "NVIDIA", kind: "api-key", authUrl: "https://org.ngc.nvidia.com/setup/personal-keys", instructions: "Copy your API key from NVIDIA NGC Personal Keys", prompt: "Paste your NVIDIA API key", placeholder: "nvapi-...", validate: { kind: "chat-completions", label: "nvidia", url: "https://integrate.api.nvidia.com/v1", baseUrl: "https://integrate.api.nvidia.com/v1", model: "nvidia/llama-3.1-nemotron-70b-instruct", optional: true } },
  { id: "novita", name: "Novita", kind: "api-key", authUrl: "https://novita.ai/settings/key-management", instructions: "Create or copy your API key from the Novita dashboard", prompt: "Paste your Novita API key", placeholder: "sk_...", validate: { kind: "chat-completions", url: "https://api.novita.ai/openai/v1", baseUrl: "https://api.novita.ai/openai/v1", model: "moonshotai/kimi-k2.7-code" } },
  { id: "deepinfra", name: "DeepInfra", kind: "api-key", authUrl: "https://deepinfra.com/dash/api_keys", instructions: "Create or copy your API key from the DeepInfra dashboard", prompt: "Paste your DeepInfra API key", placeholder: "...", validate: { kind: "chat-completions", label: "DeepInfra", url: "https://api.deepinfra.com/v1/openai", baseUrl: "https://api.deepinfra.com/v1/openai", model: "deepseek-ai/DeepSeek-V4-Flash-0731" } },
  { id: "huggingface", name: "Hugging Face Inference", kind: "api-key", authUrl: "https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained", instructions: "Create/copy a token with Make calls to Inference Providers permission (usable as HUGGINGFACE_HUB_TOKEN or HF_TOKEN)", prompt: "Paste your Hugging Face token (HUGGINGFACE_HUB_TOKEN / HF_TOKEN)", placeholder: "hf_...", validate: { kind: "chat-completions", label: "Hugging Face", url: "https://router.huggingface.co/v1", baseUrl: "https://router.huggingface.co/v1", model: "openai/gpt-oss-120b" } },
  { id: "perplexity", name: "Perplexity (Pro/Max)", kind: "custom", hookId: "perplexity" },
  { id: "qianfan", name: "Qianfan", kind: "api-key", authUrl: "https://console.bce.baidu.com/qianfan/ais/console/apiKey", instructions: "Copy your Qianfan API key from the console", prompt: "Paste your Qianfan API key", placeholder: "bce-v3/ALTAK-...", validate: { kind: "chat-completions", label: "qianfan", url: "https://qianfan.baidubce.com/v2", baseUrl: "https://qianfan.baidubce.com/v2", model: "deepseek-v3.2", tolerateModelDenied: true } },
  { id: "venice", name: "Venice", kind: "api-key", authUrl: "https://venice.ai/settings/api", instructions: "Copy your API key from the Venice dashboard", prompt: "Paste your Venice API key", placeholder: "vapi_...", validate: { kind: "chat-completions", url: "https://api.venice.ai/api/v1", baseUrl: "https://api.venice.ai/api/v1", model: "qwen3-4b" } },
  { id: "siliconflow", name: "SiliconFlow", kind: "api-key", authUrl: "https://cloud.siliconflow.com/account/ak", instructions: "Create or copy your API key from the SiliconFlow console", prompt: "Paste your SiliconFlow API key", placeholder: "sk-...", validate: { kind: "models-endpoint", label: "siliconflow", url: "https://api.siliconflow.com/v1/models" } },
  { id: "siliconflow-cn", name: "SiliconFlow (China)", kind: "api-key", authUrl: "https://cloud.siliconflow.cn/account/ak", instructions: "Create or copy your API key from the SiliconFlow console", prompt: "Paste your SiliconFlow API key", placeholder: "sk-...", validate: { kind: "models-endpoint", label: "siliconflow-cn", url: "https://api.siliconflow.cn/v1/models" } },
  { id: "synthetic", name: "Synthetic", kind: "api-key", authUrl: "https://dev.synthetic.new/docs/api/overview", instructions: "Copy your API key from the Synthetic dashboard", prompt: "Paste your Synthetic API key", placeholder: "sk-...", validate: { kind: "models-endpoint", url: "https://api.synthetic.new/openai/v1/models" } },
  { id: "nanogpt", name: "NanoGPT", kind: "api-key", authUrl: "https://nano-gpt.com/api", instructions: "Create or copy your NanoGPT API key", prompt: "Paste your NanoGPT API key", placeholder: "sk-...", validate: { kind: "models-endpoint", url: "https://nano-gpt.com/api/v1/models" } },
  { id: "wafer-serverless", name: "Wafer Serverless (pay-as-you-go)", kind: "api-key", authUrl: "https://app.wafer.ai/usage", instructions: "Create or copy your Wafer Serverless API key from the Wafer dashboard", prompt: "Paste your Wafer Serverless API key", placeholder: "wfr_...", validate: { kind: "models-endpoint", label: "Wafer Serverless", url: "https://pass.wafer.ai/v1/models" } },
  { id: "coreweave", name: "CoreWeave Serverless Inference", kind: "api-key", authUrl: "https://wandb.ai/settings", instructions: "Create or select a CoreWeave Serverless Inference project, add export COREWEAVE_PROJECT=<team>/<project> to your shell startup file (for example ~/.zshrc, ~/.bashrc, or your shell's profile/rc file) for the OpenAI-Project header, then copy your API key from account settings", prompt: "Paste your CoreWeave Serverless Inference API key", placeholder: "api-key", validate: { kind: "models-endpoint", label: "CoreWeave Serverless Inference", url: "https://api.inference.wandb.ai/v1/models" } },
  { id: "vercel-ai-gateway", name: "Vercel AI Gateway", kind: "api-key", authUrl: "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai-gateway%2Fapi-keys&title=AI+Gateway+API+Keys", instructions: "Copy your Vercel AI Gateway API key from the Vercel dashboard", prompt: "Paste your Vercel AI Gateway API key", placeholder: "vck_..." },
  { id: "cloudflare-ai-gateway", name: "Cloudflare AI Gateway", kind: "custom", hookId: "cloudflare-ai-gateway" },
  { id: "litellm", name: "LiteLLM", kind: "api-key", authUrl: "https://docs.litellm.ai/docs/proxy/deploy", instructions: "Run LiteLLM proxy (default http://localhost:4000/v1; set LITELLM_BASE_URL to customize it), then copy your master key or virtual key", prompt: "Paste your LiteLLM API key (master key or virtual key)", placeholder: "sk-..." },
  { id: "kilo", name: "Kilo Gateway", kind: "custom", hookId: "kilo" },
  { id: "zenmux", name: "ZenMux", kind: "api-key", authUrl: "https://zenmux.ai/settings/keys", instructions: "Create or copy your ZenMux API key", prompt: "Paste your ZenMux API key", placeholder: "sk-...", validate: { kind: "models-endpoint", url: "https://zenmux.ai/api/v1/models" } },
  { id: "opencode-zen", name: "OpenCode Zen", kind: "api-key", authUrl: "https://opencode.ai/auth", instructions: "Log in to the OpenCode Zen console and copy your OpenCode Zen API key", prompt: "Paste your OpenCode Zen API key", placeholder: "sk-..." },
  { id: "opencode-go", name: "OpenCode Go", kind: "api-key", authUrl: "https://opencode.ai/auth", instructions: "Log in to the OpenCode Zen console and copy your OpenCode Go API key", prompt: "Paste your OpenCode Go API key", placeholder: "sk-..." },
  { id: "yolo-auto", name: "Yolo-Auto", kind: "api-key", authUrl: "https://yolo-auto.com/app", instructions: "Create or copy your Yolo-Auto API key (yolo_...)", prompt: "Paste your Yolo-Auto API key", placeholder: "yolo_...", validate: { kind: "models-endpoint", label: "Yolo-Auto", url: "https://yolo-auto.com/v1/models" } },
  { id: "tavily", name: "Tavily", kind: "api-key", authUrl: "https://app.tavily.com/home", instructions: "Copy your Tavily API key from the API Keys page.", prompt: "Paste your Tavily API key", placeholder: "tvly-..." },
  { id: "kagi", name: "Kagi", kind: "api-key", authUrl: "https://kagi.com/settings/api", instructions: "Copy your Kagi Search API key from Kagi API settings. Search API access is beta-only; if unavailable, email support@kagi.com.", prompt: "Paste your Kagi API key", placeholder: "KG_..." },
  { id: "exa", name: "Exa", kind: "api-key", authUrl: "https://dashboard.exa.ai/api-keys", instructions: "Create or copy your API key from the Exa dashboard.", prompt: "Paste your Exa API key", placeholder: "API key" },
  { id: "parallel", name: "Parallel", kind: "api-key", authUrl: "https://platform.parallel.ai/settings?tab=api-keys", instructions: "Copy your Parallel API key from the Parallel settings page.", prompt: "Paste your Parallel API key", placeholder: "sk_..." },
  { id: "typesafe", name: "TypeSafe", kind: "api-key", authUrl: "https://console.typesafe.ai/", instructions: "Create or copy your API key from the TypeSafe console.", prompt: "Paste your TypeSafe API key", placeholder: "API key", validate: { kind: "models-endpoint", label: "TypeSafe", url: "https://api.typesafe.ai/v1/models" } },
  { id: "ollama", name: "Ollama (Local OpenAI-compatible)", kind: "api-key", authUrl: "https://github.com/ollama/ollama/blob/main/docs/api.md", instructions: "Optional: paste an Ollama API key/token for authenticated hosts. Leave empty for local no-auth mode.", prompt: "Paste your Ollama API key/token (optional)", placeholder: "ollama-local", emptyFallback: "" },
  { id: "ollama-cloud", name: "Ollama Cloud", kind: "api-key", authUrl: "https://ollama.com/settings/keys", instructions: "Create an Ollama Cloud API key, then paste it here.", prompt: "Paste your Ollama Cloud API key", placeholder: "ollama-cloud-api-key" },
  { id: "lm-studio", name: "LM Studio (Local OpenAI-compatible)", kind: "api-key", prompt: "Optional: Paste LM Studio API key (to customize endpoint URL, set LM_STUDIO_BASE_URL env var)", placeholder: "lm-studio-local", emptyFallback: "lm-studio-local" },
  { id: "llama.cpp", name: "llama.cpp (Local OpenAI-compatible)", kind: "api-key", authUrl: "https://github.com/ggml-org/llama.cpp#quick-start", instructions: "Paste your llama.cpp API key if your server requires auth. Leave empty for local no-auth mode (default base URL: http://127.0.0.1:8080; set LLAMA_CPP_BASE_URL to customize).", prompt: "Paste your llama.cpp API key (optional for local no-auth)", placeholder: "llama-cpp-local", emptyFallback: "llama-cpp-local" },
  { id: "vllm", name: "vLLM (Local OpenAI-compatible)", kind: "api-key", authUrl: "https://docs.vllm.ai/en/latest/serving/openai_compatible_server.html", instructions: "Paste your vLLM API key if your server requires auth. Leave empty for local no-auth mode (default base URL: http://127.0.0.1:8000/v1).", prompt: "Paste your vLLM API key (optional for local no-auth)", placeholder: "vllm-local", emptyFallback: "vllm-local" },
  { id: "gmi-cloud", name: "GMI Cloud", kind: "api-key", authUrl: "https://console.gmicloud.ai", instructions: "Create or copy your GMI Cloud API key", prompt: "Paste your GMI Cloud API key", placeholder: "eyJ...", validate: { kind: "models-endpoint", label: "GMI Cloud", url: "https://api.gmi-serving.com/v1/models" } },
  { id: "stencil", name: "Stencil (invite only)", kind: "oauth-code", authUrl: "https://auth.stencil.so", instructions: "Sign in to your stencil.so account in the browser. If the browser cannot reach this machine, paste the final redirect URL when prompted.", authorizeUrl: "{auth}/oauth/authorize", clientId: "omp", callbackPath: "/callback", callbackPort: 54547, scopes: ["openid", "profile", "email", "offline_access"] },
  { id: "singularityapi-dev", name: "SingularityAPI", kind: "api-key", authUrl: "https://app.singularityapi.dev", instructions: "Create an API key from the SingularityAPI dashboard, then paste it here", prompt: "Paste your SingularityAPI API key", placeholder: "sk-sapi-...", normalize: "strip-bearer", validate: { kind: "models-endpoint", label: "SingularityAPI", url: "https://api.singularityapi.dev/v1/models" } },
  { id: "singularityapi-tech", name: "SingularityAPI Reserved Lanes", kind: "api-key", authUrl: "https://app.singularityapi.tech/compute/billing", instructions: "Create a key from the SingularityAPI lanes dashboard, then paste it here", prompt: "Paste your SingularityAPI lanes key", placeholder: "sk-...", normalize: "strip-bearer", validate: { kind: "models-endpoint", label: "SingularityAPI Reserved Lanes", url: "https://api.singularityapi.tech/v1/models" } },
];

export const RIG_LOGIN_ORDER: readonly string[] = [
  "rig",
  "openai-codex",
  "anthropic",
  "zai",
  "zai-coding-plan",
  "kimi-code",
  "openrouter",
  "github-copilot",
  "cursor",
  "devin",
  "google-antigravity",
  "google-gemini-cli",
  "openai-codex-device",
  "xai",
  "xai-oauth",
  "gitlab-duo",
  "gitlab-duo-agent",
  "alibaba-coding-plan",
  "alibaba-token-plan",
  "aiand",
  "abliteration",
  "zhipu-coding-plan",
  "umans",
  "qwen-portal",
  "sakana",
  "minimax-code",
  "minimax-code-cn",
  "xiaomi",
  "xiaomi-token-plan-sgp",
  "xiaomi-token-plan-ams",
  "xiaomi-token-plan-cn",
  "firepass",
  "cline-pass",
  "commandcode",
  "charm-hyper",
  "deepseek",
  "stepfun",
  "muse-code",
  "meta",
  "moonshot",
  "cerebras",
  "baseten",
  "fireworks",
  "together",
  "nvidia",
  "novita",
  "deepinfra",
  "huggingface",
  "perplexity",
  "qianfan",
  "venice",
  "siliconflow",
  "siliconflow-cn",
  "synthetic",
  "nanogpt",
  "wafer-serverless",
  "coreweave",
  "vercel-ai-gateway",
  "cloudflare-ai-gateway",
  "litellm",
  "kilo",
  "zenmux",
  "opencode-zen",
  "opencode-go",
  "yolo-auto",
  "tavily",
  "kagi",
  "exa",
  "parallel",
  "typesafe",
  "ollama",
  "ollama-cloud",
  "lm-studio",
  "llama.cpp",
  "vllm",
  "gmi-cloud",
  "stencil",
  "singularityapi-dev",
  "singularityapi-tech",
];

const BY_ID = new Map(RIG_LOGIN_PROVIDERS.map((d) => [d.id, d]));

export function getRigLoginProvider(id: string): RigLoginProviderDef | undefined {
  return BY_ID.get(id);
}

export function isRigLoginId(id: string): boolean {
  return BY_ID.has(id);
}
