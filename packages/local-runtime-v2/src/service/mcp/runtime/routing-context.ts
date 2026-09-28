import type { RigBuildEnv } from '@rig/config';

/** Read the managed-routing gate without a config fallback. */
export function getRawRuntimeBuildEnv(): RigBuildEnv | undefined {
  const value = process.env.RIG_BUILD_ENV;
  return value === 'dev' || value === 'test' || value === 'staging' || value === 'prod'
    ? value
    : undefined;
}
