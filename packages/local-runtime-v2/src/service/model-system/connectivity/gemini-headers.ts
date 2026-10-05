/**
 * Antigravity / Gemini CLI request headers.
 *
 * Minimal port of `oh-my-pi/packages/catalog/src/wire/gemini-headers.ts`
 * without the update-manifest version discovery: the manifest fetch only
 * tunes the client version advertised in `User-Agent`, and the offline
 * pinned fallback stays valid, so discovery here uses env override → pinned
 * `2.8.0` only.
 */

export const DEFAULT_ANTIGRAVITY_VERSION = '2.8.0';

/** Current Antigravity client version: env override → pinned fallback. */
export function getAntigravityVersion(): string {
  return process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
}

/** Antigravity `User-Agent` header value. */
export function getAntigravityUserAgent(): string {
  const version = getAntigravityVersion();
  const cl = process.env.PI_AI_ANTIGRAVITY_CL || '963137146';
  const os = process.env.PI_AI_ANTIGRAVITY_OS || 'darwin';
  const arch = process.env.PI_AI_ANTIGRAVITY_ARCH || 'arm64';
  return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

/**
 * `User-Agent` string that identifies as Gemini CLI to unlock higher rate limits.
 * Same format as the official Gemini CLI (v0.35+).
 */
export function getGeminiCliUserAgent(modelId = 'gemini-3.1-pro-preview'): string {
  const version = process.env.PI_AI_GEMINI_CLI_VERSION || '0.46.0';
  const platform = process.platform === 'win32' ? 'win32' : process.platform;
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  return `GeminiCLI/${version}/${modelId} (${platform}; ${arch}; terminal)`;
}

export function getGeminiCliHeaders(modelId?: string): Record<string, string> {
  return {
    'User-Agent': getGeminiCliUserAgent(modelId),
    'Client-Metadata':
      'ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI',
  };
}
