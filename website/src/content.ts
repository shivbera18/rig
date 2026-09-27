export const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4';

export const INSTALL_CMD = 'npm install -g @shivcdhry/rig';

export interface CmdCard {
  label: string;
  lines: string[];
  copy: string;
}

export const INSTALL_CARDS: CmdCard[] = [
  { label: 'Install globally', lines: ['npm install -g @shivcdhry/rig'], copy: 'npm install -g @shivcdhry/rig' },
  {
    label: 'Run once, no install',
    lines: ['npx @shivcdhry/rig exec "list TODOs in this repo"'],
    copy: 'npx @shivcdhry/rig exec "list TODOs in this repo"',
  },
  { label: 'Update later', lines: ['rig update'], copy: 'rig update' },
  { label: 'First session', lines: ['rig', 'rig tui --model @smol'], copy: 'rig tui --model @smol' },
];

export interface Feature {
  title: string;
  body: string;
}

export const FEATURES: Feature[] = [
  {
    title: 'Persistent sessions',
    body: 'Every answer saves to ~/.rig/sessions/. Resume, fork, rewind, retry, compact. The thread outlives the terminal.',
  },
  {
    title: '45 slash commands',
    body: 'Status, usage, context, transcript, plan mode, goals, steering notes, task queue. Tab completes, fuzzy match forgives typos.',
  },
  {
    title: 'Multi-account auth pool',
    body: 'Round-robin credentials with 401/403 fallback. auth status, auth refresh, auth use keep every account healthy.',
  },
  {
    title: 'Isolated subagents',
    body: 'task spawns agents in detached git worktrees and merges their diffs back as patches. Your tree stays clean.',
  },
  {
    title: 'Model roles',
    body: '@smol for mechanical edits, @default for deep work, @vision for images. One flag switches the chain.',
  },
  {
    title: 'CI-friendly headless',
    body: 'exec --format json and --format stream-json pipe structured results into scripts, with --output and --quiet.',
  },
];

export interface TabGroup {
  id: string;
  label: string;
  lines: string[];
}

export const COMMAND_TABS: TabGroup[] = [
  {
    id: 'session',
    label: 'Session',
    lines: [
      '/new /resume /fork /rewind /retry /rename /archive',
      '/sessions /transcript /history /compact /export /copy',
      '/model /status /usage /context',
    ],
  },
  {
    id: 'run',
    label: 'Run control',
    lines: ['/queue /stop /steer /tasks /plan /goal', '/allow /deny /permissions /agents /tools /add-dir'],
  },
  {
    id: 'auth',
    label: 'Auth',
    lines: ['rig login / rig logout', 'rig auth check / rig auth status', 'rig auth refresh / rig auth use <provider> <id>'],
  },
  {
    id: 'meta',
    label: 'Meta',
    lines: ['/doctor /provider /config /settings /theme', '/hotkeys /changelog /feedback /update /review /quit'],
  },
];

export const AUTH_CARDS: CmdCard[] = [
  { label: 'Log in', lines: ['rig login', 'rig login opencode-zen'], copy: 'rig login opencode-zen' },
  { label: 'Stay healthy', lines: ['rig auth status', 'rig auth refresh'], copy: 'rig auth status' },
];

export const TYPED_PHRASES = ['list TODOs in this repo', 'compact this thread', 'review the auth flow'];
