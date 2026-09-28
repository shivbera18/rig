import type { RigBuildEnv, RigRegion } from '@rig/config';

const WEB_ORIGINS: Record<RigRegion, Record<RigBuildEnv, string>> = {
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

export function buildMcodeLogoutUrl(scope: {
  readonly region: RigRegion;
  readonly buildEnv: RigBuildEnv;
}): string {
  const origin = WEB_ORIGINS[scope.region][scope.buildEnv];
  return `${origin}/auth/logout?logout_redirect_uri=${encodeURIComponent(origin)}`;
}
