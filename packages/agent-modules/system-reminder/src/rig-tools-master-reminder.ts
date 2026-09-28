const RIG_TOOLS_MODEL_PREFIX = 'Rig-M2.7';

const RIG_TOOLS_MASTER_REMINDER = [
  '<rig-tools-master-reminder>',
  'For all video, image, and audio understanding and generation tasks, use the rig-tools-master skill.',
  '</rig-tools-master-reminder>',
].join('\n');

export function withMcodeToolsMasterReminder(input: {
  reminderText: string | undefined;
  modelID: string | undefined;
  enabled: boolean;
}): string | undefined {
  if (!input.enabled || !input.modelID?.startsWith(RIG_TOOLS_MODEL_PREFIX)) {
    return input.reminderText;
  }

  const existing = unwrapSystemReminder(input.reminderText);
  const body = existing
    ? `${existing}\n\n${RIG_TOOLS_MASTER_REMINDER}`
    : RIG_TOOLS_MASTER_REMINDER;
  return `<system-reminder>\n${body}\n</system-reminder>`;
}

function unwrapSystemReminder(text: string | undefined): string {
  const trimmed = text?.trim();
  if (!trimmed) return '';
  return trimmed
    .replace(/^<system-reminder>\s*/u, '')
    .replace(/\s*<\/system-reminder>$/u, '')
    .trim();
}
