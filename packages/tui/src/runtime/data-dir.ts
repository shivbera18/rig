import { getPrimaryDataDirPath, getProfile } from '@rig/config';
import { resolveRigDataEnvironment, type RigDataEnvironment } from '../auth/environment.js';
import { configureTuiRuntimeEnvironment } from '../cli/environment.js';

export type TuiDefaultDataDirResolver = () => string;

export interface TuiDataDirEnvironment {
  RIG_DATA_DIR?: string;
}

export interface PrepareTuiDataDirOptions {
  environment?: TuiDataDirEnvironment;
  getBuildEnv?: () => RigDataEnvironment;
  getDefaultDataDir?: TuiDefaultDataDirResolver;
  configureRuntimeEnvironment?: typeof configureTuiRuntimeEnvironment;
}

export function resolveDefaultTuiDataDir(
  _buildEnv: RigDataEnvironment,
  getPrimaryDataDir: typeof getPrimaryDataDirPath = getPrimaryDataDirPath,
  getCurrentProfile: typeof getProfile = getProfile,
): string {
  return getPrimaryDataDir(undefined, getCurrentProfile());
}

function getDefaultTuiDataDir(): string {
  return resolveDefaultTuiDataDir(resolveRigDataEnvironment());
}

function readDataDirOverride(environment: TuiDataDirEnvironment): string | undefined {
  const minimaxDataDir = environment.RIG_DATA_DIR?.trim();
  if (minimaxDataDir) return minimaxDataDir;

  const mavisDataDir = environment.RIG_DATA_DIR?.trim();
  return mavisDataDir || undefined;
}

export function getTuiDataDirPath(
  environment: TuiDataDirEnvironment = process.env,
  getDefaultDataDir: () => string = getDefaultTuiDataDir,
): string {
  return readDataDirOverride(environment) ?? getDefaultDataDir();
}

export function resolveTuiDataDir(
  getDefaultDataDir: TuiDefaultDataDirResolver = getDefaultTuiDataDir,
  environment: TuiDataDirEnvironment = process.env,
): string {
  return getTuiDataDirPath(environment, getDefaultDataDir);
}

export function prepareTuiDataDir(options: PrepareTuiDataDirOptions = {}): Promise<string> {
  const buildEnv = (options.getBuildEnv ?? resolveRigDataEnvironment)();
  const dataDir = resolveTuiDataDir(
    options.getDefaultDataDir ?? (() => resolveDefaultTuiDataDir(buildEnv)),
    options.environment ?? process.env,
  );
  (options.configureRuntimeEnvironment ?? configureTuiRuntimeEnvironment)({
    dataDir,
  });
  return Promise.resolve(dataDir);
}
