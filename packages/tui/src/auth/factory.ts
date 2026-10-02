import type { RigBuildEnv, RigRegion } from '@rig/config';
import {
  resolveRigOAuthEndpointConfig,
  type RigOAuthEndpointEnvironment,
} from '@rig/oauth-core';

import { createRigSharedAuthSession } from '../runtime/auth-session.js';
import { RigAuthApplication, type RigAuthApplicationOptions } from './application.js';
import { resolveRigAuthEnvironment } from './environment.js';
import { writeTuiRegionPreference } from './region-preference.js';

export interface CreateDefaultRigAuthApplicationOptions {
  dataDir: string;
  region?: RigRegion;
  buildEnv?: RigBuildEnv;
  oauthEndpointEnvironment?: RigOAuthEndpointEnvironment;
  createSharedSession?: typeof createRigSharedAuthSession;
  telemetry?: RigAuthApplicationOptions['telemetry'];
  telemetrySource?: RigAuthApplicationOptions['telemetrySource'];
  writeRegionPreference?: RigAuthApplicationOptions['writeRegionPreference'];
  sharedAuthCore?: RigAuthApplicationOptions['sharedAuthCore'];
}

export function createDefaultRigAuthApplication(
  options: CreateDefaultRigAuthApplicationOptions,
): RigAuthApplication {
  const environment = resolveRigAuthEnvironment({
    runtimeRegion: options.region,
    runtimeBuildEnv: options.buildEnv,
  });
  const region = options.region ?? environment.region;
  const buildEnv = options.buildEnv ?? environment.buildEnv;
  const applicationOptions = {
    dataDir: options.dataDir,
    region,
    buildEnv,
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(options.telemetrySource ? { telemetrySource: options.telemetrySource } : {}),
    writeRegionPreference: options.writeRegionPreference ?? writeTuiRegionPreference,
  } satisfies Omit<RigAuthApplicationOptions, 'sharedAuthCore'>;
  const createSharedAuthCore = (requestedRegion: RigRegion) =>
    (options.createSharedSession ?? createRigSharedAuthSession)({
      dataDir: options.dataDir,
      region: requestedRegion,
      buildEnv,
      oauthEndpoints: resolveRigOAuthEndpointConfig(
        options.oauthEndpointEnvironment ?? process.env,
        { buildEnv, region: requestedRegion },
      ),
    });
  const sharedAuthCore = options.sharedAuthCore ?? createSharedAuthCore(region);
  return new RigAuthApplication({
    ...applicationOptions,
    sharedAuthCore,
    resolveSharedAuthCore: createSharedAuthCore,
  });
}
