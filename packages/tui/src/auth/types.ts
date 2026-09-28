import type { RigBuildEnv, RigRegion } from '@rig/config';

export interface CliAuthScope {
  readonly region: RigRegion;
  readonly buildEnv: RigBuildEnv;
}
