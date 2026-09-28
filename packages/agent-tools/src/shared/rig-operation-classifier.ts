/**
 * Operation classifier shared by desktop / cloud rig.
 *
 * Command normalization in both dispatchers must exactly match observability operation labels;
 * otherwise working commands fall into Grafana's unknown bucket. Both dispatchers and the
 * classifier therefore reuse `normalizeRigCommand`.
 */

import type { ToolOperationClassifier } from '@rig/agent-core/tools';

export function normalizeRigCommand(rawCommand: string): string {
  const tokens = rawCommand.trim().split(/\s+/).filter(Boolean);
  const aliased = tokens.map((token) => (token === '-h' || token === '--help' ? 'help' : token));
  return aliased.join(' ');
}

export function createRigOperationClassifier(
  allowedValues: readonly string[],
): ToolOperationClassifier {
  const allowed = new Set(allowedValues);
  return {
    allowedValues,
    classify(args) {
      if (!args || typeof args !== 'object' || Array.isArray(args)) return undefined;
      const rawCommand = (args as { command?: unknown }).command;
      if (typeof rawCommand !== 'string') return undefined;
      const command = normalizeRigCommand(rawCommand);
      return allowed.has(command) ? command : undefined;
    },
  };
}
