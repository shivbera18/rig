import {
  installRigToolsLauncher,
  removeRigToolsLaunchers,
  validateRigToolsResource,
  type RigToolsBuildEnv,
  type RigToolsRegion,
} from './resource.js';
import { startRigToolsAuthLeaseBroker, type RigToolsAuthLeaseBroker } from './lease-broker.js';
import type { RigToolsHostAuthSession, RigToolsHostLogger } from './contracts.js';

export interface StartRigToolsHostIntegrationOptions {
  dataDir: string;
  resourceDir: string;
  expectedBuildEnv: RigToolsBuildEnv;
  executable: string;
  platform: NodeJS.Platform;
  region: RigToolsRegion;
  bedrockLane?: string;
  session: RigToolsHostAuthSession;
  logger?: RigToolsHostLogger;
}

export interface ActiveRigToolsHostIntegration {
  readonly launcherPath: string;
  readonly brokerEndpoint: string;
  readonly packageName: string;
  readonly version: string;
  dispose(): Promise<void>;
}

export interface RigToolsHostIntegrationDependencies {
  validateResource: typeof validateRigToolsResource;
  startBroker: typeof startRigToolsAuthLeaseBroker;
  installLauncher: typeof installRigToolsLauncher;
  removeLaunchers: typeof removeRigToolsLaunchers;
}

const DEFAULT_DEPENDENCIES: RigToolsHostIntegrationDependencies = {
  validateResource: validateRigToolsResource,
  startBroker: startRigToolsAuthLeaseBroker,
  installLauncher: installRigToolsLauncher,
  removeLaunchers: removeRigToolsLaunchers,
};

export async function startRigToolsHostIntegration(
  options: StartRigToolsHostIntegrationOptions,
  dependencies: RigToolsHostIntegrationDependencies = DEFAULT_DEPENDENCIES,
): Promise<ActiveRigToolsHostIntegration> {
  const resource = dependencies.validateResource({
    resourceDir: options.resourceDir,
    expectedBuildEnv: options.expectedBuildEnv,
  });
  const broker = await dependencies.startBroker({
    dataDir: options.dataDir,
    session: options.session,
    ...(options.logger ? { logger: options.logger } : {}),
  });
  try {
    const installed = await dependencies.installLauncher({
      resourceDir: options.resourceDir,
      expectedBuildEnv: options.expectedBuildEnv,
      dataDir: options.dataDir,
      executable: options.executable,
      platform: options.platform,
      region: options.region,
      ...(options.bedrockLane ? { bedrockLane: options.bedrockLane } : {}),
      brokerEndpoint: broker.endpoint,
      brokerCapabilityFile: broker.capabilityFile,
    });
    return activeIntegration(options, dependencies, broker, installed.launcherPath, resource);
  } catch (error) {
    let cleanupError: unknown;
    try {
      dependencies.removeLaunchers(options.dataDir, options.region);
    } catch (cause) {
      cleanupError = cause;
    }
    try {
      await broker.dispose();
    } catch (cause) {
      cleanupError = cleanupError
        ? new AggregateError([cleanupError, cause], 'rig-tools startup cleanup failed')
        : cause;
    }
    if (cleanupError) {
      throw new AggregateError([error, cleanupError], 'rig-tools host integration failed');
    }
    throw error;
  }
}

function activeIntegration(
  options: StartRigToolsHostIntegrationOptions,
  dependencies: RigToolsHostIntegrationDependencies,
  broker: RigToolsAuthLeaseBroker,
  launcherPath: string,
  resource: ReturnType<typeof validateRigToolsResource>,
): ActiveRigToolsHostIntegration {
  let disposed = false;
  return {
    launcherPath,
    brokerEndpoint: broker.endpoint,
    packageName: resource.manifest.packageName,
    version: resource.manifest.version,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      let launcherError: unknown;
      try {
        dependencies.removeLaunchers(options.dataDir, options.region);
      } catch (error) {
        launcherError = error;
      }
      try {
        await broker.dispose();
      } catch (error) {
        if (launcherError) {
          throw new AggregateError([launcherError, error], 'rig-tools cleanup failed');
        }
        throw error;
      }
      if (launcherError) throw launcherError;
    },
  };
}
