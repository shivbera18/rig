import type { RigBuildEnv, RigRegion } from '@rig/config';

const SAFETY_API_BASE: Record<RigRegion, Record<RigBuildEnv, string>> = {
  cn: {
    dev: 'https://matrix-test.example.invalid',
    test: 'https://matrix-test.example.invalid',
    staging: 'https://matrix-pre.example.invalid',
    prod: 'https://agent.rig.cn',
  },
  en: {
    dev: 'https://matrix-overseas-test.example.invalid',
    test: 'https://matrix-overseas-test.example.invalid',
    staging: 'https://matrix-overseas-pre.example.invalid',
    prod: 'https://agent.rig.io',
  },
};

export function resolveSafetyApiBase(
  region: RigRegion,
  buildEnv: RigBuildEnv,
  testBaseURL: string | undefined,
): string {
  if (buildEnv === 'test' && testBaseURL && isLoopbackHttpURL(testBaseURL)) {
    return testBaseURL.replace(/\/+$/u, '');
  }
  return SAFETY_API_BASE[region][buildEnv];
}

function isLoopbackHttpURL(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}
