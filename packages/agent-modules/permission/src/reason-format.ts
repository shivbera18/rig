/**
 * Localized DecisionReason formatter — produces the human-readable `reason`
 * strings emitted at the wire by `LocalPermissionFacade`.
 *
 * Templates are keyed by `'en' | 'zh'`. Default mode (no LLM) and auto mode
 * (with LLM prefix) MUST go through the same table so the two pipelines stay
 * in sync. When adding a new DecisionReason variant, add its template here
 * too — missing keys surface as a TypeScript error.
 */

import type { UserLocaleHint } from './locale-detect.js';
import type {
  PermissionBehavior,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
  DecisionReason,
  SubcommandResult,
} from './types.js';

export type Lang = 'en' | 'zh';

export function localeOrDefault(locale: UserLocaleHint): Lang {
  return locale === 'zh' ? 'zh' : 'en';
}

const ACTION_LABEL: Record<Lang, Record<PermissionBehavior, string>> = {
  en: { allow: 'Allowed', ask: 'Needs confirmation', deny: 'Blocked' },
  zh: { allow: 'Allowed', ask: 'Needs confirmation', deny: 'Blocked' },
};

const BEHAVIOR_LABEL: Record<Lang, Record<PermissionBehavior, string>> = {
  en: { allow: 'allow', ask: 'ask', deny: 'deny' },
  zh: { allow: 'allow', ask: 'ask', deny: 'deny' },
};

const SOURCE_LABEL: Record<Lang, Record<PermissionRuleSource, string>> = {
  en: { global: 'global', agent: 'agent', session: 'session' },
  zh: { global: 'global', agent: 'agent', session: 'session' },
};

const MODE_OFF_REASON: Record<Lang, string> = {
  en: 'Allowed: permission mode is off; permission review was skipped.',
  zh: 'Allowed: permission mode is off; permission review was skipped.',
};

const MODE_BYPASS_REASON: Record<Lang, string> = {
  en: 'Allowed: permission mode is bypassPermissions and no bypass-immune safety rule matched.',
  zh: 'Allowed: permission mode is bypassPermissions and no bypass-immune safety rule matched.',
};

function formatMode(_lang: Lang, mode: PermissionMode): string {
  return `Allowed by permission mode: ${mode}.`;
}

function formatWorkingDirectoryReason(
  behavior: PermissionBehavior | undefined,
  fsPath: string,
  lang: Lang,
): string {
  if (behavior === 'allow') {
    return `Allowed: filesystem path is within an approved read/write boundary. Path: ${fsPath}`;
  }
  if (behavior === 'ask') {
    return `Needs confirmation: filesystem path is outside the workspace or configured allow paths. Path: ${fsPath}`;
  }
  return `Blocked: filesystem path is outside the workspace or configured allow paths. Path: ${fsPath}`;
}

function formatInternalWhitelistReason(fsPath: string, _lang: Lang): string {
  return `Allowed: internal Rig-managed path. Path: ${fsPath}`;
}

function formatTrustedExactWriteReason(fsPath: string, _lang: Lang): string {
  return `Allowed: the current turn allows writing the exact path. Path: ${fsPath}`;
}

function formatTempDirectoryReason(fsPath: string, _lang: Lang): string {
  return `Allowed: filesystem path is inside a temporary directory. Path: ${fsPath}`;
}

const SANDBOX_REASON: Record<Lang, string> = {
  en: 'Allowed: path is covered by the sandbox allow-list.',
  zh: 'Allowed: path is covered by the sandbox allow-list.',
};

function formatPathValidationReason(error: string, _lang: Lang): string {
  return `Blocked: invalid filesystem path. ${error}`;
}

function formatDangerousRemovalReason(fsPath: string, _lang: Lang): string {
  return `Blocked: dangerous removal target. Path: ${fsPath}`;
}

function formatRmRewriteReason(rewrittenCommand: string, _lang: Lang): string {
  return `Allowed: rm command was rewritten to rig-trash for recoverable deletion. Original command: ${rewrittenCommand}`;
}

const UNKNOWN_REASON: Record<Lang, string> = {
  en: 'Unknown reason',
  zh: 'Unknown reason',
};

const EMPTY_BASH_REASON: Record<Lang, string> = {
  en: 'Allowed: empty bash command.',
  zh: 'Allowed: empty bash command.',
};

function formatSubcommandSummary(
  prefix: string,
  command: string,
  detail: string,
  _lang: Lang,
): string {
  return `${prefix}: bash subcommand decision for "${command}". ${detail}`;
}

function formatRuleDecisionReason(rule: PermissionRule, lang: Lang): string {
  const behavior = rule.ruleBehavior;
  const action = ACTION_LABEL[lang][behavior];
  const source = SOURCE_LABEL[lang][rule.source];
  const behaviorWord = BEHAVIOR_LABEL[lang][behavior];
  const scope = rule.ruleValue.ruleContent
    ? `${rule.ruleValue.toolName}(${rule.ruleValue.ruleContent})`
    : rule.ruleValue.toolName;
  return `${action}: matched ${source} ${behaviorWord} permission rule for ${scope}.`;
}

function formatSafetyDecisionReason(
  description: string,
  behavior: PermissionBehavior | undefined,
  lang: Lang,
): string {
  if (
    /^(<system-reminder|Allowed|Blocked|Needs confirmation|Auto classifier|LLM classifier|No LLM client|⚠️)/u.test(
      description,
    )
  ) {
    return description;
  }
  if (behavior === 'allow') {
    return `Allowed: ${description}`;
  }
  if (behavior === 'deny') {
    return `Blocked: ${description}`;
  }
  return `Needs confirmation: ${description}`;
}

function formatSubcommandDecisionReason(
  reasons: Map<string, SubcommandResult>,
  lang: Lang = 'en',
): string {
  if (reasons.size === 0) return EMPTY_BASH_REASON[lang];
  const priority: Record<PermissionBehavior, number> = { deny: 0, ask: 1, allow: 2 };
  const entries = [...reasons.entries()].sort(
    ([, a], [, b]) => priority[a.behavior] - priority[b.behavior],
  );
  const first = entries[0];
  if (!first) return EMPTY_BASH_REASON[lang];
  const [command, result] = first;
  const detail = formatDecisionReason(result.reason, result.behavior, lang);
  const prefix = ACTION_LABEL[lang][result.behavior];
  return formatSubcommandSummary(prefix, command, detail, lang);
}

/**
 * Render a `DecisionReason` (or bare `PermissionRule`) into a user-facing
 * string.
 */
export function formatDecisionReason(
  reason: PermissionRule | DecisionReason,
  behavior?: PermissionBehavior,
  locale: UserLocaleHint | Lang = 'en',
): string {
  const lang = localeOrDefault(locale as UserLocaleHint);
  if ('type' in reason) {
    switch (reason.type) {
      case 'rule':
        return formatRuleDecisionReason(reason.rule, lang);
      case 'safetyCheck':
        return formatSafetyDecisionReason(reason.description, behavior, lang);
      case 'mode':
        if (reason.mode === 'off') {
          return MODE_OFF_REASON[lang];
        }
        if (reason.mode === 'bypassPermissions') {
          return MODE_BYPASS_REASON[lang];
        }
        return formatMode(lang, reason.mode);
      case 'workingDirectory':
        return formatWorkingDirectoryReason(behavior, reason.path, lang);
      case 'internalWhitelist':
        return formatInternalWhitelistReason(reason.path, lang);
      case 'trustedExactWrite':
        return formatTrustedExactWriteReason(reason.path, lang);
      case 'tempDirectory':
        return formatTempDirectoryReason(reason.path, lang);
      case 'sandbox':
        return SANDBOX_REASON[lang];
      case 'pathValidation':
        return formatPathValidationReason(reason.error, lang);
      case 'dangerousRemoval':
        return formatDangerousRemovalReason(reason.path, lang);
      case 'subcommandResults':
        return formatSubcommandDecisionReason(reason.reasons, lang);
      case 'rmRewrite':
        return formatRmRewriteReason(reason.rewrittenCommand, lang);
      case 'recoverableDeleteRewrite':
        return formatRmRewriteReason(reason.targets.join(' '), lang);
      default:
        return UNKNOWN_REASON[lang];
    }
  }
  // Bare PermissionRule.
  return formatRuleDecisionReason(reason, lang);
}

// ---------------------------------------------------------------------------
// Auto-mode classifier prefixes (used by the LocalPermissionFacade
// cloud-gateway branch).
// ---------------------------------------------------------------------------

const AUTO_CLASSIFIER_ALLOW_PREFIX: Record<Lang, string> = {
  en: 'Auto classifier',
  zh: 'Auto classifier',
};

const AUTO_CLASSIFIER_BLOCK_PREFIX: Record<Lang, string> = {
  en: '⚠️ Blocked by auto classifier; explicit confirmation required to continue',
  zh: '⚠️ Blocked by auto classifier; explicit confirmation required to continue',
};

const AUTO_CLASSIFIER_CONFIRM_PREFIX: Record<Lang, string> = {
  en: 'Needs confirmation',
  zh: 'Needs confirmation',
};

const AUTO_CLASSIFIER_TIMEOUT_TEMPLATE: Record<Lang, (suffix: string) => string> = {
  en: (suffix) => `⚠️ Auto classifier timed out${suffix}; asking user to confirm.`,
  zh: (suffix) => `⚠️ Auto classifier timed out${suffix}; asking user to confirm.`,
};
export function formatAutoClassifierReason(
  verdict: 'allow' | 'block' | 'confirm' | 'timeout',
  reasonText: string,
  locale: UserLocaleHint,
): string {
  const lang = localeOrDefault(locale);
  const sep = lang === 'zh' ? '：' : ': ';
  switch (verdict) {
    case 'allow':
      return `${AUTO_CLASSIFIER_ALLOW_PREFIX[lang]}${sep}${reasonText}`;
    case 'block':
      return `${AUTO_CLASSIFIER_BLOCK_PREFIX[lang]}${sep}${reasonText}`;
    case 'timeout':
      return AUTO_CLASSIFIER_TIMEOUT_TEMPLATE[lang](reasonText);
    case 'confirm':
    default:
      return `${AUTO_CLASSIFIER_CONFIRM_PREFIX[lang]}${sep}${reasonText}`;
  }
}

// ---------------------------------------------------------------------------
// Blocked-tool reason — the string handed to the LLM when a tool call is
// denied at `beforeToolCall`. The model reads this to decide how to recover
// (try another approach / explain to the user / drop a blocked rule), so the
// source is surfaced as a machine-readable tag.
// ---------------------------------------------------------------------------

/**
 * Where a tool-call denial originated. Surfaced to the LLM so it can tell a
 * user veto apart from a configured rule apart from a built-in safety wall.
 *
 *   - `user`          — the user rejected the call in the confirmation dialog
 *                       (includes auto-mode cloud `block` that was downgraded
 *                       to ask and then rejected).
 *   - `rule`          — matched a user-configured `deny` permission rule.
 *   - `safety`        — matched a built-in safety boundary (HARD final-deny,
 *                       dangerous removal, invalid path, …).
 *   - `safety-immune` — bypass-immune safety deny (UNC / network share,
 *                       `rm -rf /`, `rm -rf ~`). Cannot be relaxed by any mode.
 */
export type ToolDenialSource = 'user' | 'rule' | 'safety' | 'safety-immune';

export interface BlockedToolReasonInput {
  source: ToolDenialSource;
  toolName: string;
  /**
   * Already-localized decision reason for non-user denials — the engine /
   * facade output from {@link formatDecisionReason}. Rendered as the body.
   */
  detail?: string;
  /**
   * Already-localized reason the confirmation was raised in the first place
   * (original safety / cloud-classifier text), carried through on a `user`
   * denial so the model knows what the user vetoed.
   */
  trigger?: string;
}

/**
 * Render the LLM-facing denial string. The leading `[permission:denied
 * source=<source>]` tag is intentionally fixed English so the model (and log
 * greps) can parse the origin regardless of the user's locale; the trailing
 * body reuses the already-localized `detail` / `trigger` text verbatim.
 */
export function formatBlockedToolReason(input: BlockedToolReasonInput): string {
  const { source, toolName, detail, trigger } = input;
  const tag = `[permission:denied source=${source}]`;
  if (source === 'user') {
    const base = `${tag} User rejected the \`${toolName}\` call in the confirmation dialog.`;
    return trigger ? `${base} Trigger: ${trigger}` : base;
  }
  const body = detail && detail.trim().length > 0 ? detail : `\`${toolName}\` call was denied.`;
  return `${tag} ${body}`;
}
