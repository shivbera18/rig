import type { RigUpdatePlan } from './application.js';

export interface RigStartupUpdateNotice {
  readonly latestVersion: string;
}

export function resolveRigStartupUpdateNotice(
  plan: RigUpdatePlan,
): RigStartupUpdateNotice | undefined {
  if (plan.kind !== 'available' && plan.kind !== 'package-manager') return undefined;
  const latestVersion = plan.latestVersion.trim();
  return latestVersion ? { latestVersion } : undefined;
}
