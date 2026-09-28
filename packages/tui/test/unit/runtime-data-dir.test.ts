import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getTuiDataDirPath,
  prepareTuiDataDir,
  resolveDefaultTuiDataDir,
} from '../../src/runtime/data-dir.js';

describe('TUI data directory', () => {
  it.each(['dev', 'test', 'staging', 'prod'] as const)(
    'uses the shared user directory for %s builds',
    (buildEnv) => {
      expect(resolveDefaultTuiDataDir(buildEnv, undefined, () => null)).toBe(
        join(homedir(), '.rig'),
      );
    },
  );

  it('keeps the shared profile suffix', () => {
    expect(resolveDefaultTuiDataDir('prod', undefined, () => 'smoke')).toBe(
      join(homedir(), '.rig-smoke'),
    );
  });

  it.each([
    [{}, '/default'],
    [{ RIG_DATA_DIR: '  ', RIG_DATA_DIR: ' ' }, '/default'],
    [{ RIG_DATA_DIR: ' /public ', RIG_DATA_DIR: '/legacy' }, '/public'],
    [{ RIG_DATA_DIR: ' ', RIG_DATA_DIR: ' /legacy ' }, '/legacy'],
  ])('preserves override precedence for %j', (environment, expected) => {
    expect(getTuiDataDirPath(environment, () => '/default')).toBe(expected);
  });

  it('passes the selected directory to runtime initialization', async () => {
    const configureRuntimeEnvironment = vi.fn();
    await expect(prepareTuiDataDir({
      environment: { RIG_DATA_DIR: ' /selected ' },
      getBuildEnv: () => 'prod',
      configureRuntimeEnvironment,
    })).resolves.toBe('/selected');
    expect(configureRuntimeEnvironment).toHaveBeenCalledWith({ dataDir: '/selected' });
  });
});
