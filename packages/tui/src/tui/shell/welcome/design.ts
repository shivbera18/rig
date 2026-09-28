export const RIG_WELCOME_PASTE_IMAGE_SHORTCUT = '{paste-image-shortcut}';
const RIG_WELCOME_CHECKIN_TIP = '/checkin claims the daily reward.';

export const RIG_WELCOME_DESIGN = {
  sectionTitles: {
    tips: 'Tips for getting started',
    news: "What's new · /changelog for history",
  },
  tipPool: [
    'Say what you want and how to verify it.',
    `Use @ for files; ${RIG_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
    'Run /init to teach Rig this repo.',
    'Use /plan before a change that needs design or investigation.',
    'Use /context to check the current Session context budget.',
    'Use /sessions to resume earlier work.',
    'Use /history to review and branch from earlier prompts.',
    'Use /goal to keep long-running work focused on a finish line.',
    'Use /permission to choose how Rig handles tool approvals.',
    'Use /feedback to preview a redacted report before upload.',
    RIG_WELCOME_CHECKIN_TIP,
  ],
  wide: {
    tips: [
      'Say what you want and how to verify it.',
      `Use @ for files; ${RIG_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
      'Run /init to teach Rig this repo.',
      RIG_WELCOME_CHECKIN_TIP,
    ],
    news: [
      'Send follow-ups while Rig works.',
      '/context shows read-only session context.',
      '/feedback previews before upload.',
    ],
  },
  stacked: {
    tips: [
      'Say what you want and how to verify it.',
      `@ files · ${RIG_WELCOME_PASTE_IMAGE_SHORTCUT} images · /init guidance`,
      '/checkin daily reward',
    ],
    news: ['Follow-ups wait while Rig works.', '/context budget · /feedback preview'],
  },
  compact: {
    tips: [
      `@ files · ${RIG_WELCOME_PASTE_IMAGE_SHORTCUT} images`,
      '/init repo guidance',
      '/checkin reward',
    ],
    news: ['Follow-ups wait', '/context · /feedback'],
  },
  hero: {
    fullMinWidth: 30,
    mediumMinWidth: 24,
    microMinWidth: 8,
    fallbackTitle: 'R',
  },
} as const;

export const RIG_TERMINAL_WORDMARK = [
  '██████╗ ██╗ ██████╗ ',
  '██╔══██╗██║██╔════╝ ',
  '██████╔╝██║██║  ███╗',
  '██║  ██║██║██║   ██║',
  '██║  ██║██║╚██████╔╝',
  '╚═╝  ╚═╝╚═╝ ╚═════╝ ',
] as const;

export const RIG_TERMINAL_MEDIUM_WORDMARK = [
  '██████╗ ██╗ ██████╗ ',
  '██╔══██╗██║██╔════╝ ',
  '██████╔╝██║██║  ███╗',
  '██║  ██║██║╚██████╔╝',
] as const;

export const RIG_TERMINAL_MICRO_WORDMARK = [
  '██████╗ ',
  '██╔══██╗',
  '██████╔╝',
  '██║  ██║',
  '██║  ██║',
  '╚═╝  ╚═╝',
] as const;
