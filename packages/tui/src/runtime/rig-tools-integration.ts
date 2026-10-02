import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RigBuildEnv, RigRegion } from '@rig/config';
import {
  startRigToolsAuthLeaseBroker,
  validateRigToolsResource,
  type RigToolsAuthLeaseBroker,
  type RigToolsBuildEnv,
  type RigToolsHostAuthSession,
  type RigToolsHostLogger,
  type ValidatedRigToolsResource,
} from '@rig/rig-tools-host';

import {
  activateTuiRigToolsHostEnvironment,
  type TuiRigToolsHostEnvironmentActivation,
} from '../cli/rig-tools-environment.js';

export type RigToolsReadinessCategory =
  | 'disabled'
  | 'ready'
  | 'resource_unavailable'
  | 'broker_unavailable'
  | 'host_unavailable';

export interface RigToolsReadiness {
  readonly requested: boolean;
  readonly ready: boolean;
  readonly category: RigToolsReadinessCategory;
  readonly buildEnv: RigToolsBuildEnv;
  readonly version?: string;
  ensureCommandPath(): void;
  dispose(): Promise<void>;
}

export interface PrepareTuiRigToolsIntegrationOptions {
  requested: boolean;
  dataDir: string;
  buildEnv: RigBuildEnv;
  region: RigRegion;
  session: RigToolsHostAuthSession;
  entryUrl: string;
  bedrockLane?: string;
  environment?: Record<string, string | undefined>;
  logger?: RigToolsHostLogger;
}

export interface PrepareTuiRigToolsIntegrationDependencies {
  validateResource?: typeof validateRigToolsResource;
  startBroker?: typeof startRigToolsAuthLeaseBroker;
  createRuntimeDir?: typeof createTuiRigToolsRuntimeDir;
  removeRuntimeDir?: typeof removeTuiRigToolsRuntimeDir;
  activateEnvironment?: typeof activateTuiRigToolsHostEnvironment;
}

const NOOP_DISPOSE = async (): Promise<void> => undefined;
const NOOP = (): void => undefined;

export function resolveBundledRigToolsResourceDir(
  entryUrl: string,
  environment: Record<string, string | undefined> = process.env,
): string {
  if (environment.RIG_DEV_RIG_TOOLS_MODE === 'published') {
    const override = environment.RIG_DEV_RIG_TOOLS_RESOURCE_DIR?.trim();
    if (!override || !path.isAbsolute(override)) {
      throw new Error('RIG_DEV_RIG_TOOLS_RESOURCE_DIR must be an absolute path');
    }
    return path.normalize(override);
  }
  return path.join(path.dirname(fileURLToPath(entryUrl)), 'embedded', 'rig-tools');
}

export function resolveBundledRigToolsCommandBinDir(entryUrl: string): string {
  return path.join(path.dirname(fileURLToPath(entryUrl)), 'internal-bin');
}

export async function prepareTuiRigToolsIntegration(
  options: PrepareTuiRigToolsIntegrationOptions,
  dependencies: PrepareTuiRigToolsIntegrationDependencies = {},
): Promise<RigToolsReadiness> {
  const buildEnv = normalizeRigToolsHostBuildEnv(options.buildEnv);
  if (!options.requested) return inactiveReadiness(false, 'disabled', buildEnv);

  const logger = options.logger ?? { info: () => undefined, warn: () => undefined };
  const environment = options.environment ?? process.env;
  const removeRuntimeDir = dependencies.removeRuntimeDir ?? removeTuiRigToolsRuntimeDir;
  let runtimeDir: string | undefined;
  let broker: RigToolsAuthLeaseBroker | undefined;
  let activation: TuiRigToolsHostEnvironmentActivation | undefined;
  try {
    const resource = (dependencies.validateResource ?? validateRigToolsResource)({
      resourceDir: resolveBundledRigToolsResourceDir(options.entryUrl, environment),
      expectedBuildEnv: buildEnv,
    });
    runtimeDir = await (dependencies.createRuntimeDir ?? createTuiRigToolsRuntimeDir)();
    broker = await (dependencies.startBroker ?? startRigToolsAuthLeaseBroker)({
      dataDir: runtimeDir,
      session: options.session,
      logger,
    });
    const configDir = path.join(options.dataDir, 'integrations', 'rig-tools', options.region);
    await ensurePrivateDirectory(configDir);
    activation = (dependencies.activateEnvironment ?? activateTuiRigToolsHostEnvironment)(
      environment,
      {
        runtimeExecutable: process.execPath,
        brokerEndpoint: broker.endpoint,
        brokerCapabilityFile: broker.capabilityFile,
        configDir,
        region: options.region,
        commandBinDir: resolveBundledRigToolsCommandBinDir(options.entryUrl),
        ...(options.bedrockLane ? { bedrockLane: options.bedrockLane } : {}),
      },
    );
    const readiness = activeReadiness({
      buildEnv,
      resource,
      broker,
      runtimeDir,
      removeRuntimeDir,
      activation,
    });
    logger.info(
      `rig-tools readiness category=${readiness.category} buildEnv=${buildEnv} region=${options.region} version=${resource.manifest.version}`,
    );
    return readiness;
  } catch (error) {
    activation?.restore();
    await broker?.dispose().catch(() => undefined);
    if (runtimeDir) await removeRuntimeDir(runtimeDir).catch(() => undefined);
    const category = classifyReadinessFailure(error);
    logger.warn(
      `rig-tools readiness category=${category} buildEnv=${buildEnv} region=${options.region}`,
    );
    return inactiveReadiness(true, category, buildEnv);
  }
}

export function normalizeRigToolsHostBuildEnv(buildEnv: RigBuildEnv): RigToolsBuildEnv {
  return buildEnv === 'dev' ? 'test' : buildEnv;
}

export async function createTuiRigToolsRuntimeDir(): Promise<string> {
  // macOS Unix-domain sockets have a short path limit. `/tmp` keeps the
  // process-private broker endpoint bounded even when the user's dataDir is long.
  const parent = process.platform === 'win32' ? tmpdir() : '/tmp';
  const runtimeDir = await mkdtemp(path.join(parent, `rig-tools-tui-${process.pid}-`));
  if (process.platform !== 'win32') await chmod(runtimeDir, 0o700);
  return runtimeDir;
}

export function removeTuiRigToolsRuntimeDir(runtimeDir: string): Promise<void> {
  return rm(runtimeDir, { recursive: true, force: true });
}

function activeReadiness(options: {
  buildEnv: RigToolsBuildEnv;
  resource: ValidatedRigToolsResource;
  broker: RigToolsAuthLeaseBroker;
  runtimeDir: string;
  removeRuntimeDir: (runtimeDir: string) => Promise<void>;
  activation: TuiRigToolsHostEnvironmentActivation;
}): RigToolsReadiness {
  let disposed = false;
  return {
    requested: true,
    ready: true,
    category: 'ready',
    buildEnv: options.buildEnv,
    version: options.resource.manifest.version,
    ensureCommandPath: options.activation.ensureCommandPath,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      options.activation.restore();
      const errors: unknown[] = [];
      try {
        await options.broker.dispose();
      } catch (error) {
        errors.push(error);
      }
      try {
        await options.removeRuntimeDir(options.runtimeDir);
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'rig-tools TUI cleanup failed');
    },
  };
}

function inactiveReadiness(
  requested: boolean,
  category: Exclude<RigToolsReadinessCategory, 'ready'>,
  buildEnv: RigToolsBuildEnv,
): RigToolsReadiness {
  return {
    requested,
    ready: false,
    category,
    buildEnv,
    ensureCommandPath: NOOP,
    dispose: NOOP_DISPOSE,
  };
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await chmod(directory, 0o700);
}

function classifyReadinessFailure(
  error: unknown,
): Exclude<RigToolsReadinessCategory, 'disabled' | 'ready'> {
  if (isErrorCode(error, 'EADDRINUSE')) return 'broker_unavailable';
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (
    [
      'manifest',
      'resource',
      'sha256',
      'build environment',
      'package mismatch',
      'embedded cli',
    ].some((needle) => message.includes(needle))
  ) {
    return 'resource_unavailable';
  }
  if (message.includes('broker') || message.includes('socket') || message.includes('named pipe')) {
    return 'broker_unavailable';
  }
  return 'host_unavailable';
}

function isErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === code,
  );
}
