import type { TuiStatusLineItem } from '../../shell/status-line-items.js';

const en = {
  title: 'Status Line',
  search: 'Search',
  preview: 'Preview',
  defaults: 'Defaults',
  unavailable: 'No current data; hidden until available.',
  empty: 'Status line hidden',
  noMatches: 'No matching items',
  saving: 'Saving…',
  failed: 'Could not save. Check config.yaml syntax and permissions; previous settings kept.',
  locked: 'build-mode is startup-only. Edit config.yaml and restart to change it.',
  help: 'Space toggle · ←/→ reorder · Enter save · Esc cancel',
  compactHelp: 'Space · ←→ · Enter · Esc',
  reset: 'Ctrl+R restores defaults; type to search',
  filtered: 'Clear search before reordering',
  custom: 'Uses the saved command. Starts only after saving; preview never runs it.',
  close: 'Enter / Esc close',
} as const;
const zh: Record<keyof typeof en, string> = { ...en };

const descriptions: Record<Exclude<TuiStatusLineItem, 'build-mode'>, readonly [string, string]> = {
  'current-dir': ['Current working directory', 'Current working directory'],
  'session-title': ['Current session title', 'Current session title'],
  'git-branch': ['Current Git branch', 'Current Git branch'],
  'review-link': ['Current branch PR / MR link', 'Current branch PR / MR link'],
  'plan-mode': ['Plan mode', 'Plan mode'],
  'approval-mode': ['Current permission mode', 'Current permission mode'],
  'model-with-reasoning': ['Model and reasoning', 'Model and reasoning'],
  model: ['Model name', 'Model name'],
  'context-window': ['Context window capacity', 'Context window capacity'],
  subagent: ['Subagent identity', 'Subagent identity'],
  'token-quota': ['Account token quota', 'Account token quota'],
  'cache-read-ratio': ['Session cache read ratio', 'Session cache read ratio'],
  'context-remaining': ['Remaining context window', 'Remaining context window'],
  'context-meter': ['Remaining context gauge', 'Remaining context gauge'],
  'custom-command': ['Configured custom command output', 'Configured custom command output'],
};

export function statusLineText(key: keyof typeof en, _locale?: string): string {
  return en[key];
}

export function statusLineItemDescription(
  item: Exclude<TuiStatusLineItem, 'build-mode'>,
  _locale?: string,
): string {
  return descriptions[item][0];
}
