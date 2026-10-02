import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import {
  validateEmbeddedResourceFiles,
  validateEmbeddedResourceManifest,
} from './resource-manifest.mjs';

import {
  AUTH_LEASE_PROTOCOL_PACKAGE_NAME,
  AUTH_LEASE_PROTOCOL_PACKAGE_VERSION,
  AUTH_LEASE_PROTOCOL_VERSION,
} from '@rig/oauth-lease-protocol';

export type RigToolsBuildEnv = 'test' | 'staging' | 'prod';
export type RigToolsRegion = 'cn' | 'en';

export interface RigToolsManifest {
  schemaVersion: 3 | 4;
  packageName: string;
  version: string;
  gitSha: string;
  buildEnv: RigToolsBuildEnv;
  bedrockLane: string;
  nodeRange: string;
  entry: 'cli.mjs';
  auth: {
    mode: 'shared-broker';
    protocol: {
      name: typeof AUTH_LEASE_PROTOCOL_PACKAGE_NAME;
      version: typeof AUTH_LEASE_PROTOCOL_PACKAGE_VERSION;
      wireVersion: typeof AUTH_LEASE_PROTOCOL_VERSION;
    };
  };
  nativePackages: { name: 'registry-js'; version: string; napiVersion: 3 }[];
  resources: [{ path: 'cli.mjs'; sha256: string }, ...{ path: string; sha256: string }[]];
}

export interface ValidatedRigToolsResource {
  rootDir: string;
  cliPath: string;
  manifest: RigToolsManifest;
}

export function validateRigToolsResource(options: {
  resourceDir: string;
  expectedBuildEnv: RigToolsBuildEnv;
}): ValidatedRigToolsResource {
  const manifestPath = path.join(options.resourceDir, 'manifest.json');
  if (!existsSync(manifestPath)) throw new Error('rig-tools manifest is missing');

  let value: unknown;
  try {
    value = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('rig-tools manifest is not valid JSON');
  }
  const manifest = parseManifest(value);
  if (manifest.buildEnv !== options.expectedBuildEnv) {
    throw new Error(
      `rig-tools build environment mismatch: expected ${options.expectedBuildEnv}, received ${manifest.buildEnv}`,
    );
  }
  const expectedPackageName = packageNameForBuildEnv(options.expectedBuildEnv);
  if (manifest.packageName !== expectedPackageName) {
    throw new Error(
      `rig-tools package mismatch: expected ${expectedPackageName}, received ${manifest.packageName}`,
    );
  }

  const cliPath = path.join(options.resourceDir, manifest.entry);
  if (!existsSync(cliPath)) throw new Error('rig-tools embedded cli is missing');
  validateEmbeddedResourceFiles(options.resourceDir, manifest);

  return { rootDir: options.resourceDir, cliPath, manifest };
}

export async function installRigToolsLauncher(options: {
  resourceDir: string;
  expectedBuildEnv: RigToolsBuildEnv;
  dataDir: string;
  executable: string;
  platform: NodeJS.Platform;
  region: RigToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): Promise<{
  launcherPath: string;
  regionalLauncherPath: string;
  resource: ValidatedRigToolsResource;
}> {
  const resource = validateRigToolsResource(options);
  const binDir = path.join(options.dataDir, 'bin');
  const configDir = path.join(options.dataDir, 'integrations', 'rig-tools', options.region);
  mkdirSync(binDir, { recursive: true, mode: 0o700 });
  mkdirSync(configDir, { recursive: true, mode: 0o700 });
  chmodSync(binDir, 0o700);
  chmodSync(configDir, 0o700);

  const isWindows = options.platform === 'win32';
  const launcherPath = path.join(binDir, isWindows ? 'rig-tools.cmd' : 'rig-tools');
  const regionLabel = options.region === 'cn' ? 'cn' : 'global';
  const regionalLauncherPath = path.join(
    binDir,
    isWindows ? `rig-tools-${regionLabel}.cmd` : `rig-tools-${regionLabel}`,
  );
  const staleLauncherPaths = isWindows
    ? ['rig-tools', 'rig-tools-cn', 'rig-tools-global']
    : ['rig-tools.cmd', 'rig-tools-cn.cmd', 'rig-tools-global.cmd'];
  const bedrockLane = resolveManagedBedrockLane(options.bedrockLane);
  const contents = isWindows
    ? renderWindowsLauncher({
        executable: options.executable,
        cliPath: resource.cliPath,
        configDir,
        region: options.region,
        ...(bedrockLane ? { bedrockLane } : {}),
        brokerEndpoint: options.brokerEndpoint,
        brokerCapabilityFile: options.brokerCapabilityFile,
      })
    : renderPosixLauncher({
        executable: options.executable,
        cliPath: resource.cliPath,
        configDir,
        region: options.region,
        ...(bedrockLane ? { bedrockLane } : {}),
        brokerEndpoint: options.brokerEndpoint,
        brokerCapabilityFile: options.brokerCapabilityFile,
      });
  const dispatcher = isWindows ? renderWindowsDispatcher() : renderPosixDispatcher();

  writeFileIfChanged(regionalLauncherPath, contents, isWindows ? 0o600 : 0o755);
  writeFileIfChanged(launcherPath, dispatcher, isWindows ? 0o600 : 0o755);
  for (const staleName of staleLauncherPaths) {
    rmSync(path.join(binDir, staleName), { force: true });
  }
  return { launcherPath, regionalLauncherPath, resource };
}

export function removeRigToolsLaunchers(dataDir: string, region?: RigToolsRegion): void {
  const binDir = path.join(dataDir, 'bin');
  const regionLabels = region ? [region === 'cn' ? 'cn' : 'global'] : ['cn', 'global'];
  for (const name of regionLabels.flatMap((label) => [
    `rig-tools-${label}`,
    `rig-tools-${label}.cmd`,
  ])) {
    rmSync(path.join(binDir, name), { force: true });
  }
  const hasRegionalLauncher = ['cn', 'global'].some(
    (label) =>
      existsSync(path.join(binDir, `rig-tools-${label}`)) ||
      existsSync(path.join(binDir, `rig-tools-${label}.cmd`)),
  );
  if (!hasRegionalLauncher) {
    rmSync(path.join(binDir, 'rig-tools'), { force: true });
    rmSync(path.join(binDir, 'rig-tools.cmd'), { force: true });
  }
}

function renderPosixDispatcher(): string {
  return [
    '#!/bin/sh',
    'rig_tools_bin_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
    'rig_tools_region=${RIG_REGION:-}',
    'case "$rig_tools_region" in',
    '  cn) rig_tools_target="$rig_tools_bin_dir/rig-tools-cn" ;;',
    '  en|global) rig_tools_target="$rig_tools_bin_dir/rig-tools-global" ;;',
    '  "")',
    '    if [ -x "$rig_tools_bin_dir/rig-tools-cn" ] && [ ! -x "$rig_tools_bin_dir/rig-tools-global" ]; then',
    '      rig_tools_target="$rig_tools_bin_dir/rig-tools-cn"',
    '    elif [ -x "$rig_tools_bin_dir/rig-tools-global" ] && [ ! -x "$rig_tools_bin_dir/rig-tools-cn" ]; then',
    '      rig_tools_target="$rig_tools_bin_dir/rig-tools-global"',
    '    else',
    '      echo "RIG_REGION must be cn or global when both regional rig-tools launchers are installed." >&2',
    '      exit 2',
    '    fi',
    '    ;;',
    '  *) echo "Invalid RIG_REGION; expected cn or global." >&2; exit 2 ;;',
    'esac',
    'exec "$rig_tools_target" "$@"',
    '',
  ].join('\n');
}

function renderWindowsDispatcher(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "rig_tools_region=%RIG_REGION%"',
    'if /i "%rig_tools_region%"=="cn" goto rig_tools_cn',
    'if /i "%rig_tools_region%"=="en" goto rig_tools_global',
    'if /i "%rig_tools_region%"=="global" goto rig_tools_global',
    'if defined rig_tools_region goto rig_tools_invalid',
    'if exist "%~dp0rig-tools-cn.cmd" if not exist "%~dp0rig-tools-global.cmd" goto rig_tools_cn',
    'if exist "%~dp0rig-tools-global.cmd" if not exist "%~dp0rig-tools-cn.cmd" goto rig_tools_global',
    'echo RIG_REGION must be cn or global when both regional rig-tools launchers are installed. 1>&2',
    'exit /b 2',
    ':rig_tools_cn',
    'call "%~dp0rig-tools-cn.cmd" %*',
    'exit /b %ERRORLEVEL%',
    ':rig_tools_global',
    'call "%~dp0rig-tools-global.cmd" %*',
    'exit /b %ERRORLEVEL%',
    ':rig_tools_invalid',
    'echo Invalid RIG_REGION; expected cn or global. 1>&2',
    'exit /b 2',
    '',
  ].join('\r\n');
}

export function renderPosixLauncher(options: {
  executable: string;
  cliPath: string;
  configDir: string;
  region: RigToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): string {
  const lines = [
    '#!/bin/sh',
    'unset RIG_ACCESS_TOKEN RIG_DATA_DIR RIG_DATA_DIR RIG_PORT RIG_PROFILE IS_SANDBOX RIG_API_BASE_URL RIG_AUTH_BASE_URL RIG_CLIENT_ID RIG_SCOPE RIG_AUTH_PROVIDER RIG_AUTH_BROKER_ENDPOINT RIG_AUTH_BROKER_CAPABILITY_FILE RIG_EXTRA_HEADERS',
    "for rig_tools_name in $(env | sed -n 's/^\\([^=]*\\)=.*$/\\1/p'); do",
    '  case "$rig_tools_name" in',
    '    __RIG_PARENT_*|__RIG_RUNTIME_*|AGENTARCHON_*|AGENT_ARCHON_*) unset "$rig_tools_name" ;;',
    '  esac',
    'done',
    'unset rig_tools_name',
    'export ELECTRON_RUN_AS_NODE=1',
    `export RIG_REGION=${quotePosix(options.region)}`,
    `export RIG_CONFIG_DIR=${quotePosix(options.configDir)}`,
  ];
  lines.push(
    'export RIG_AUTH_PROVIDER=shared-broker',
    `export RIG_AUTH_BROKER_ENDPOINT=${quotePosix(options.brokerEndpoint)}`,
    `export RIG_AUTH_BROKER_CAPABILITY_FILE=${quotePosix(options.brokerCapabilityFile)}`,
  );
  if (options.bedrockLane) {
    lines.push(
      `export RIG_EXTRA_HEADERS=${quotePosix(`bedrock_lane:${options.bedrockLane},bedrock-lane:${options.bedrockLane}`)}`,
    );
  }
  lines.push(`exec ${quotePosix(options.executable)} ${quotePosix(options.cliPath)} "$@"`, '');
  return lines.join('\n');
}

export function renderWindowsLauncher(options: {
  executable: string;
  cliPath: string;
  configDir: string;
  region: RigToolsRegion;
  bedrockLane?: string;
  brokerEndpoint: string;
  brokerCapabilityFile: string;
}): string {
  const lines = [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    'set "RIG_ACCESS_TOKEN="',
    'set "RIG_DATA_DIR="',
    'set "RIG_DATA_DIR="',
    'set "RIG_PORT="',
    'set "RIG_PROFILE="',
    'set "IS_SANDBOX="',
    'set "RIG_API_BASE_URL="',
    'set "RIG_AUTH_BASE_URL="',
    'set "RIG_CLIENT_ID="',
    'set "RIG_SCOPE="',
    'set "RIG_AUTH_PROVIDER="',
    'set "RIG_AUTH_BROKER_ENDPOINT="',
    'set "RIG_AUTH_BROKER_CAPABILITY_FILE="',
    'set "RIG_EXTRA_HEADERS="',
    'for /f "tokens=1 delims==" %%V in (\'set __RIG_PARENT_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set __RIG_RUNTIME_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set AGENTARCHON_ 2^>nul\') do set "%%V="',
    'for /f "tokens=1 delims==" %%V in (\'set AGENT_ARCHON_ 2^>nul\') do set "%%V="',
    'set "ELECTRON_RUN_AS_NODE=1"',
    `set "RIG_REGION=${escapeWindowsBatchValue(options.region)}"`,
    `set "RIG_CONFIG_DIR=${escapeWindowsBatchValue(options.configDir)}"`,
  ];
  lines.push(
    'set "RIG_AUTH_PROVIDER=shared-broker"',
    `set "RIG_AUTH_BROKER_ENDPOINT=${escapeWindowsBatchValue(options.brokerEndpoint)}"`,
    `set "RIG_AUTH_BROKER_CAPABILITY_FILE=${escapeWindowsBatchValue(options.brokerCapabilityFile)}"`,
  );
  if (options.bedrockLane) {
    lines.push(
      `set "RIG_EXTRA_HEADERS=${escapeWindowsBatchValue(`bedrock_lane:${options.bedrockLane},bedrock-lane:${options.bedrockLane}`)}"`,
    );
  }
  lines.push(
    `"${escapeWindowsBatchValue(options.executable)}" "${escapeWindowsBatchValue(options.cliPath)}" %*`,
    'exit /b %ERRORLEVEL%',
    '',
  );
  return lines.join('\r\n');
}

function parseManifest(value: unknown): RigToolsManifest {
  if (!value || typeof value !== 'object') throw new Error('rig-tools manifest is invalid');
  const input = value as Record<string, unknown>;
  const buildEnv = input.buildEnv;
  if (buildEnv !== 'test' && buildEnv !== 'staging' && buildEnv !== 'prod') {
    throw new Error('rig-tools manifest buildEnv is invalid');
  }
  if (input.entry !== 'cli.mjs') throw new Error('rig-tools manifest entry is invalid');
  for (const key of ['packageName', 'version', 'gitSha', 'nodeRange'] as const) {
    if (typeof input[key] !== 'string' || input[key].trim().length === 0) {
      throw new Error(`rig-tools manifest ${key} is invalid`);
    }
  }
  if (typeof input.bedrockLane !== 'string') {
    throw new Error('rig-tools manifest bedrockLane is invalid');
  }
  if (buildEnv !== 'test' && input.bedrockLane.trim().length > 0) {
    throw new Error('rig-tools non-test manifest must not select a Bedrock lane');
  }

  const auth = input.auth as Record<string, unknown> | undefined;
  const protocol = auth?.protocol as Record<string, unknown> | undefined;
  if (
    (input.schemaVersion !== 3 && input.schemaVersion !== 4) ||
    auth?.mode !== 'shared-broker' ||
    protocol?.name !== AUTH_LEASE_PROTOCOL_PACKAGE_NAME ||
    protocol?.version !== AUTH_LEASE_PROTOCOL_PACKAGE_VERSION ||
    protocol?.wireVersion !== AUTH_LEASE_PROTOCOL_VERSION
  ) {
    throw new Error('rig-tools shared-broker lease protocol manifest is incompatible');
  }
  if (hasOwn(input, 'sharedLocal') || hasOwn(input, 'platform') || hasOwn(input, 'arch')) {
    throw new Error(
      'rig-tools shared-broker manifest must not contain shared-local platform metadata',
    );
  }
  validateEmbeddedResourceManifest(input);
  return input as unknown as RigToolsManifest;
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function resolveManagedBedrockLane(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const lane = value.trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(lane)) {
    throw new Error('rig-tools Bedrock lane is invalid');
  }
  return lane;
}

function packageNameForBuildEnv(buildEnv: RigToolsBuildEnv): string {
  if (buildEnv === 'test') return '@rig/rig-tools-test';
  if (buildEnv === 'staging') return '@rig/rig-tools-staging';
  return '@rig/rig-tools';
}

function quotePosix(value: string): string {
  if (/\r|\n|\0/u.test(value)) throw new Error('rig-tools launcher path contains control data');
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

function escapeWindowsBatchValue(value: string): string {
  if (/\r|\n|\0|"/u.test(value)) {
    throw new Error('rig-tools launcher path contains unsupported characters');
  }
  return value.replace(/%/gu, '%%');
}

function writeFileIfChanged(file: string, contents: string, mode: number): void {
  if (existsSync(file) && readFileSync(file, 'utf8') === contents) {
    chmodSync(file, mode);
    return;
  }
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, contents, { mode });
  try {
    renameSync(temporary, file);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  chmodSync(file, mode);
}
