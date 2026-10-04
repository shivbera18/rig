import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';
import { parseRigVersion } from './release.js';
import type { RigUpdateOperationOptions } from './progress.js';

export const RIG_INTERNAL_NPM_REGISTRY = 'https://npmmirror.example.invalid/';
export const RIG_PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
export const RIG_PUBLIC_NPM_MIRROR_REGISTRY = 'https://registry.npmmirror.com/';
const REGISTRY_FETCH_TIMEOUT_MS = 30_000;
const RIG_PACKAGE_BASENAME = 'rig';
const RIG_INTERNAL_SCOPE = '@rig';
const RIG_PUBLIC_SCOPE = '@shivcdhry';
// Public packaging rewrites this marker together with the bundled package identity.
const RIG_EMBEDDED_PACKAGE_NAME = '@shivcdhry/rig' as RigNpmPackageName;

export type RigNpmDistTag = 'latest' | 'test' | 'preview';
export type RigNpmPackageName = '@shivcdhry/rig' | '@rig-ai/code';
type TuiBuildEnvironment = 'test' | 'staging' | 'prod';

declare const __TUI_BUILD_ENV__: TuiBuildEnvironment | undefined;
declare const __TUI_NPM_DIST_TAG__: RigNpmDistTag | undefined;

export type RigPackageManagerInstallSource =
  | 'npm-global'
  | 'npm-prefix'
  | 'pnpm-global'
  | 'yarn-global'
  | 'bun-global';

export type RigInstallSource =
  | 'managed-installer'
  | RigPackageManagerInstallSource
  | 'unsupported';

export interface RigPackageManagerCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly display: string;
}

export interface RigNpmPrefixInstall {
  readonly executable: string;
  readonly packageName: RigNpmPackageName;
  readonly prefix: string;
  readonly registry: string;
}

export type RigPackageManagerRunOptions = RigUpdateOperationOptions;

export interface RigNpmDistribution {
  readonly packageName: RigNpmPackageName;
  readonly registry: string;
}

export interface ResolveLatestRigRegistryVersionDependencies {
  readonly platform: NodeJS.Platform;
  readonly run: (command: string, args: readonly string[]) => Promise<string>;
  readonly distribution: RigNpmDistribution;
  readonly npmExecutable: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly runtimeExecutable: string;
}

export interface RigInstallSourceDiagnosis {
  readonly packageRoot?: string;
  readonly npmGlobalPrefix?: string;
  readonly npmGlobalPrefixError?: string;
}

export type RigInstallSourceDetection =
  | RigInstallSource
  | { readonly source: RigInstallSource; readonly diagnosis: RigInstallSourceDiagnosis };

export interface DetectRigInstallSourceDependencies {
  readonly installRoot: string;
  readonly platform: NodeJS.Platform;
  readonly environment: NodeJS.ProcessEnv;
  readonly packageRoot: () => string | undefined;
  readonly npmGlobalPrefix: () => Promise<string>;
  readonly managedInstall: (installRoot: string) => boolean;
  readonly prefixInstall: () => RigNpmPrefixInstall | undefined;
}

export function isManagedRigInstallRoot(installRoot: string): boolean {
  const metadataFile = path.join(installRoot, 'install.json');
  try {
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
    return metadata.product === 'rig' && metadata.updateOwner === 'rig-installer';
  } catch {
    return false;
  }
}

export async function detectRigInstallSource(
  dependencies: Partial<DetectRigInstallSourceDependencies> & { installRoot: string },
): Promise<RigInstallSourceDetection> {
  const platform = dependencies.platform ?? process.platform;
  const environment = dependencies.environment ?? process.env;
  const resolved: DetectRigInstallSourceDependencies = {
    installRoot: dependencies.installRoot,
    platform,
    environment,
    packageRoot: dependencies.packageRoot ?? resolveRigPackageRoot,
    npmGlobalPrefix:
      dependencies.npmGlobalPrefix ??
      (() => {
        const execution = resolveRigNpmExecution({ platform, environment });
        return runText(
          execution.executable,
          [...execution.argsPrefix, 'prefix', '--global'],
          execution.environment,
        );
      }),
    managedInstall: dependencies.managedInstall ?? isManagedRigInstallRoot,
    prefixInstall: dependencies.prefixInstall ?? resolveRigNpmPrefixInstall,
  };

  if (resolved.managedInstall(resolved.installRoot)) return 'managed-installer';
  if (resolved.prefixInstall()) return 'npm-prefix';

  const packageRoot = resolved.packageRoot();
  if (!packageRoot) return { source: 'unsupported', diagnosis: {} };
  const heuristic = classifyRigInstallPath(packageRoot);
  if (heuristic) return heuristic;

  try {
    const npmGlobalPrefix = await resolved.npmGlobalPrefix();
    const source = classifyNpmGlobalInstall(packageRoot, npmGlobalPrefix, platform);
    return source === 'unsupported'
      ? { source, diagnosis: { packageRoot, npmGlobalPrefix } }
      : source;
  } catch (error) {
    return {
      source: 'unsupported',
      diagnosis: {
        packageRoot,
        npmGlobalPrefixError: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function formatRigInstallSourceDiagnosis(diagnosis: RigInstallSourceDiagnosis): string {
  const prefix =
    diagnosis.npmGlobalPrefix ??
    `<unavailable${diagnosis.npmGlobalPrefixError ? `: ${diagnosis.npmGlobalPrefixError}` : ''}>`;
  return `packageRoot=${diagnosis.packageRoot ?? '<unknown>'}; npmGlobalPrefix=${prefix}`;
}

export function classifyRigInstallPath(
  packageRoot: string,
): RigPackageManagerInstallSource | undefined {
  const normalized = packageRoot.replaceAll('\\', '/').toLocaleLowerCase();
  // Match the published layout (@shivcdhry/rig) plus legacy upstream layouts.
  const pkg = String.raw`(?:@shivcdhry\/rig|@rig(?:-ai)?\/code)`;
  if (new RegExp(String.raw`\/pnpm\/global\/(?:v11\/[^/]+|[^/]+)\/node_modules\/` + pkg + String.raw`$`, 'u').test(normalized)) {
    return 'pnpm-global';
  }
  if (new RegExp(String.raw`\/(?:\.config\/yarn|\.yarn)\/global\/node_modules\/` + pkg + String.raw`$`, 'u').test(normalized)) {
    return 'yarn-global';
  }
  if (new RegExp(String.raw`\/\.bun\/install\/global\/node_modules\/` + pkg + String.raw`$`, 'u').test(normalized)) {
    return 'bun-global';
  }
  if (
    new RegExp(String.raw`\/lib\/node_modules\/` + pkg + String.raw`$`, 'u').test(normalized) ||
    new RegExp(String.raw`\/npm\/node_modules\/` + pkg + String.raw`$`, 'u').test(normalized)
  ) {
    return 'npm-global';
  }
  return undefined;
}

export function resolveRigNpmDistribution(
  packageName: RigNpmPackageName = resolveRigPackageName() ?? RIG_EMBEDDED_PACKAGE_NAME,
  registry?: string,
): RigNpmDistribution {
  // Legacy upstream identities resolve to the published package: the
  // tarball/install paths still reference @rig-ai/code in tests and caches.
  const normalizedName =
    packageName === ('@rig-ai/code' as RigNpmPackageName) ? RIG_EMBEDDED_PACKAGE_NAME : packageName;
  if (normalizedName === rigPackageName(RIG_INTERNAL_SCOPE)) {
    const resolvedRegistry = registry ? new URL(registry).href : RIG_INTERNAL_NPM_REGISTRY;
    if (resolvedRegistry === RIG_INTERNAL_NPM_REGISTRY) {
      return { packageName: normalizedName, registry: resolvedRegistry };
    }
    throw new Error(`Unsupported Rig npm registry: ${resolvedRegistry}`);
  }
  if (normalizedName === rigPackageName(RIG_PUBLIC_SCOPE)) {
    const resolvedRegistry = registry ? new URL(registry).href : RIG_PUBLIC_NPM_REGISTRY;
    if (
      resolvedRegistry === RIG_PUBLIC_NPM_REGISTRY ||
      resolvedRegistry === RIG_PUBLIC_NPM_MIRROR_REGISTRY
    ) {
      return { packageName: normalizedName, registry: resolvedRegistry };
    }
    throw new Error(`Unsupported Rig npm registry: ${resolvedRegistry}`);
  }
  throw new Error(`Unsupported Rig npm package: ${String(packageName)}`);
}

export function resolveRigNpmDistTag(
  environment: TuiBuildEnvironment | undefined = readEmbeddedTuiBuildEnvironment(),
  embeddedTag: RigNpmDistTag | undefined = readEmbeddedTuiNpmDistTag(),
): RigNpmDistTag {
  if (embeddedTag) return embeddedTag;
  if (environment === 'test') return 'test';
  if (environment === 'staging') return 'preview';
  return 'latest';
}

export function classifyNpmGlobalInstall(
  packageRoot: string,
  globalPrefix: string,
  platform: NodeJS.Platform = process.platform,
): RigInstallSource {
  const normalizedRoot = normalizeResolvedPath(packageRoot, platform);
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const packageName =
    rigPackageNameFromPath(packageRoot) ?? rigPackageName(RIG_INTERNAL_SCOPE);
  const candidates =
    platform === 'win32'
      ? [platformPath.join(globalPrefix, 'node_modules', packageName)]
      : [
          platformPath.join(globalPrefix, 'lib', 'node_modules', packageName),
          platformPath.join(globalPrefix, 'node_modules', packageName),
        ];
  return candidates.some(
    (candidate) => normalizeResolvedPath(candidate, platform) === normalizedRoot,
  )
    ? 'npm-global'
    : 'unsupported';
}

export function buildRigPackageManagerCommand(
  source: RigPackageManagerInstallSource,
  version: string,
  platform: NodeJS.Platform = process.platform,
  distribution: RigNpmDistribution = resolveRigNpmDistribution(),
  prefixInstall?: RigNpmPrefixInstall,
): RigPackageManagerCommand {
  const targetVersion = ['latest', 'preview', 'test'].includes(version)
    ? version
    : parseRigVersion(version);
  const target = `${distribution.packageName}@${targetVersion}`;
  const registryArgs = ['--registry', distribution.registry] as const;
  const registryDisplay = `--registry ${distribution.registry}`;
  const npmInstallArgs = [
    '--ignore-scripts=false',
    '--include=optional',
    `--allow-scripts=${distribution.packageName},better-sqlite3`,
  ];
  const npmInstallDisplay = npmInstallArgs.join(' ');
  switch (source) {
    case 'npm-prefix': {
      if (!prefixInstall) throw new Error('Rig npm prefix ownership metadata is missing.');
      if (
        prefixInstall.packageName !== distribution.packageName ||
        new URL(prefixInstall.registry).href !== distribution.registry
      ) {
        throw new Error('Rig npm prefix ownership does not match the installed package.');
      }
      return {
        executable: prefixInstall.executable,
        args: [
          'install',
          '--global',
          '--prefix',
          prefixInstall.prefix,
          target,
          ...npmInstallArgs,
          ...registryArgs,
        ],
        display:
          `${prefixInstall.executable} install --global --prefix ${prefixInstall.prefix} ` +
          `${target} ${npmInstallDisplay} ${registryDisplay}`,
      };
    }
    case 'npm-global':
      return {
        executable: platform === 'win32' ? 'npm.cmd' : 'npm',
        args: ['install', '--global', target, ...npmInstallArgs, ...registryArgs],
        display: `npm install --global ${target} ${npmInstallDisplay} ${registryDisplay}`,
      };
    case 'pnpm-global':
      return {
        executable: platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        args: ['add', '--global', target, ...registryArgs],
        display: `pnpm add --global ${target} ${registryDisplay}`,
      };
    case 'yarn-global':
      return {
        executable: platform === 'win32' ? 'yarn.cmd' : 'yarn',
        args: ['global', 'add', target, ...registryArgs],
        display: `yarn global add ${target} ${registryDisplay}`,
      };
    case 'bun-global':
      return {
        executable: platform === 'win32' ? 'bun.exe' : 'bun',
        args: ['add', '--global', target, ...registryArgs],
        display: `bun add --global ${target} ${registryDisplay}`,
      };
  }
}

export async function resolveLatestRigRegistryVersion(
  tag: RigNpmDistTag,
  dependencies: Partial<ResolveLatestRigRegistryVersionDependencies> = {},
): Promise<string> {
  const platform = dependencies.platform ?? process.platform;
  const distribution = dependencies.distribution ?? resolveRigNpmDistribution();
  const runtimeExecutable = dependencies.runtimeExecutable ?? process.execPath;
  if (dependencies.run) {
    // nvm4w/npm shims run `node` from PATH; a stale PATH entry breaks every
    // npm call even when node.exe sits next to npm.cmd. Prefer the adjacent
    // runtime first, then the npm.cmd shim, then bare `npm` from PATH.
    // Callers without a runtime keep the historical bare-shim behavior.
    if (!dependencies.runtimeExecutable) {
      const npmExecutable =
        dependencies.npmExecutable ??
        resolveNodeAdjacentNpm(platform, dependencies.environment, runtimeExecutable) ??
        (platform === 'win32' ? 'npm.cmd' : 'npm');
      return parseRigRegistryVersion(
        tag,
        await dependencies.run(npmExecutable, [
          'view',
          `${distribution.packageName}@${tag}`,
          'version',
          '--json',
          '--registry',
          distribution.registry,
          '--fetch-timeout',
          String(REGISTRY_FETCH_TIMEOUT_MS),
        ]),
      );
    }
    const execution = resolveRigNpmExecution({
      platform,
      environment: dependencies.environment,
      runtimeExecutable: dependencies.runtimeExecutable,
      ...(dependencies.npmExecutable ? { npmExecutableHint: dependencies.npmExecutable } : {}),
    });
    return parseRigRegistryVersion(
      tag,
      await dependencies.run(execution.executable, [
        ...execution.argsPrefix,
        'view',
        `${distribution.packageName}@${tag}`,
        'version',
        '--json',
        '--registry',
        distribution.registry,
        '--fetch-timeout',
        String(REGISTRY_FETCH_TIMEOUT_MS),
      ]),
    );
  }
  const execution = resolveRigNpmExecution({
    platform,
    environment: dependencies.environment,
    runtimeExecutable,
    ...(dependencies.npmExecutable ? { npmExecutableHint: dependencies.npmExecutable } : {}),
  });
  const output = await runText(
    execution.executable,
    [
      ...execution.argsPrefix,
      'view',
      `${distribution.packageName}@${tag}`,
      'version',
      '--json',
      '--registry',
      distribution.registry,
      '--fetch-timeout',
      String(REGISTRY_FETCH_TIMEOUT_MS),
    ],
    execution.environment,
  );
  return parseRigRegistryVersion(tag, output);
}

function parseRigRegistryVersion(tag: RigNpmDistTag, output: string): string {
  let version: unknown;
  try {
    version = JSON.parse(output);
  } catch {
    version = output.trim();
  }
  if (Array.isArray(version)) {
    if (version.length !== 1) {
      throw new Error('Rig registry returned an invalid latest version.');
    }
    version = version[0];
  }
  if (typeof version !== 'string') {
    throw new Error('Rig registry returned an invalid latest version.');
  }
  const parsed = parseRigVersion(version);
  if (tag === 'latest' && parsed.includes('-')) {
    throw new Error('Rig latest must resolve to a stable semantic version.');
  }
  return parsed;
}

function readEmbeddedTuiBuildEnvironment(): TuiBuildEnvironment | undefined {
  if (typeof __TUI_BUILD_ENV__ === 'undefined') return undefined;
  return __TUI_BUILD_ENV__;
}

function readEmbeddedTuiNpmDistTag(): RigNpmDistTag | undefined {
  if (typeof __TUI_NPM_DIST_TAG__ === 'undefined') return undefined;
  return __TUI_NPM_DIST_TAG__;
}

export function bindRigNpmCommandToRuntime(
  command: RigPackageManagerCommand,
  runtimeExecutable: string,
): RigPackageManagerCommand {
  const npmExecutable = realpathSync(command.executable);
  const npmDirectory = path.dirname(npmExecutable);
  // Unix npm is normally a symlink to npm-cli.js. Windows npm.cmd prefers its
  // adjacent node.exe over PATH, so bypass that shim and invoke the JS entry.
  const candidates = [
    ...(path.basename(npmExecutable) === 'npm-cli.js' ? [npmExecutable] : []),
    path.join(npmDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(npmDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const npmCli =
    candidates.find((file) => existsSync(file) && statSync(file).isFile()) ??
    resolvePnpmNpmShim(npmExecutable);
  if (!npmCli)
    throw new Error(`Cannot locate npm-cli.js for the owned npm executable: ${command.executable}`);
  return { ...command, executable: runtimeExecutable, args: [npmCli, ...command.args] };
}

function resolveNodeAdjacentNpm(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv = process.env,
  runtimeExecutable: string = process.execPath,
): string | undefined {
  if (platform !== 'win32') return undefined;
  // A wrapper-root npm.cmd on PATH (installer-owned or test shim) wins over
  // the runtime-adjacent copy, matching cross-spawn PATH resolution.
  const onPath = findNpmCmdOnPath(environment);
  if (onPath) return onPath;
  try {
    const adjacent = runtimeExecutable.replace(/node\.exe$/i, 'npm.cmd');
    if (existsSync(adjacent) && statSync(adjacent).isFile()) return adjacent;
  } catch {
    // Fall through to undefined below.
  }
  return undefined;
}

function findNpmCmdOnPath(environment: NodeJS.ProcessEnv): string | undefined {
  for (const key of Object.keys(environment)) {
    if (key.toLowerCase() !== 'path') continue;
    const entry = String(environment[key] ?? '')
      .split(path.delimiter)
      .map((part) => path.join(part, 'npm.cmd'))
      .find((candidate) => {
        try {
          return existsSync(candidate) && statSync(candidate).isFile();
        } catch {
          return false;
        }
      });
    if (entry) return entry;
  }
  return undefined;
}

function resolvePnpmNpmShim(npmExecutable: string): string | undefined {
  // versioned CLI target; never execute/source the shim or search other runtimes.
  try {
    const metadata = statSync(npmExecutable);
    if (!metadata.isFile() || metadata.size > 64 * 1024) return undefined;
    const lines = readFileSync(npmExecutable, 'utf8').split(/\r?\n/u);
    const commands = lines.map((line) => line.trim()).filter((line) => /^exec\s/u.test(line));
    if (commands.length === 0) return undefined;
    const targets = commands.map((line) =>
      /^exec (?:"\$basedir\/node"|node) "\$basedir\/(nodejs\/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\/lib\/node_modules\/npm\/bin\/npm-cli\.js)" "\$@"$/u.exec(line)?.[1],
    );
    const target = targets[0];
    if (!target || targets.some((candidate) => candidate !== target)) return undefined;
    const npmDirectory = path.dirname(npmExecutable);
    const versionRoot = path.join(npmDirectory, ...target.split('/').slice(0, 2));
    const cli = realpathSync(path.join(npmDirectory, target));
    // Reject symlinks that redirect the target outside this pnpm Node version.
    if (!isResolvedPathInside(versionRoot, cli, path) || !statSync(cli).isFile()) return undefined;
    return cli;
  } catch {
    return undefined;
  }
}
export interface RigNpmExecution {
  readonly executable: string;
  readonly argsPrefix: readonly string[];
  readonly environment: NodeJS.ProcessEnv;
}

export interface ResolveRigNpmExecutionOptions {
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly runtimeExecutable?: string;
  readonly npmExecutableHint?: string;
  readonly executeShim?: boolean;
}

export function resolveRigNpmExecution(
  options: ResolveRigNpmExecutionOptions = {},
): RigNpmExecution {
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const runtimeExecutable = options.runtimeExecutable ?? process.execPath;
  const fixedEnvironment = createRigNpmRuntimeEnvironment(environment, runtimeExecutable, platform);
  // Explicit hints bind to the running Node through npm-cli.js derivation;
  // unresolvable hints fall back to executing as located with fixed PATH.
  if (options.npmExecutableHint) {
    const hint = options.npmExecutableHint;
    const hintBase = hint.toLowerCase().replaceAll('\\', '/').split('/').pop();
    if (hintBase === 'npm-cli.js') {
      return {
        executable: runtimeExecutable,
        argsPrefix: [hint],
        environment: fixedEnvironment,
      };
    }
    try {
      const bound = bindRigNpmCommandToRuntime(
        { executable: hint, args: [], display: hint },
        runtimeExecutable,
      );
      return { executable: bound.executable, argsPrefix: bound.args, environment: fixedEnvironment };
    } catch {
      return { executable: hint, argsPrefix: [], environment: fixedEnvironment };
    }
  }
  if (platform !== 'win32' || options.executeShim) {
    // Managed-installer npm must execute the shim itself: installer-owned
    // wrappers perform work (env setup, invocation markers) around npm-cli.js.
    const shim =
      platform === 'win32'
        ? (resolveNodeAdjacentNpm(platform, environment, runtimeExecutable) ?? 'npm.cmd')
        : 'npm';
    return { executable: shim, argsPrefix: [], environment: fixedEnvironment };
  }
  // (a) npm-cli.js adjacent to the running Node.
  const runtimeCli = findRuntimeAdjacentNpmCli(runtimeExecutable);
  if (runtimeCli) {
    return { executable: runtimeExecutable, argsPrefix: [runtimeCli], environment: fixedEnvironment };
  }
  // (b) npm-cli.js derived from the PATH/adjacent npm.cmd shim, else the shim
  // itself with the runtime dir first on PATH as the last resort.
  const shim = resolveNodeAdjacentNpm(platform, environment, runtimeExecutable) ?? 'npm.cmd';
  try {
    const bound = bindRigNpmCommandToRuntime(
      { executable: shim, args: [], display: shim },
      runtimeExecutable,
    );
    return { executable: bound.executable, argsPrefix: bound.args, environment: fixedEnvironment };
  } catch {
    return { executable: shim, argsPrefix: [], environment: fixedEnvironment };
  }
}

// ponytail: duplicate candidate list with bindRigNpmCommandToRuntime (minus the
// pnpm-shim parse, which needs an on-disk shim); unify if a third copy appears.
function findRuntimeAdjacentNpmCli(runtimeExecutable: string): string | undefined {
  try {
    const runtime = realpathSync(runtimeExecutable);
    const runtimeDirectory = path.dirname(runtime);
    const candidates = [
      path.join(runtimeDirectory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(runtimeDirectory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];
    return candidates.find((file) => {
      try {
        return existsSync(file) && statSync(file).isFile();
      } catch {
        return false;
      }
    });
  } catch {
    return undefined;
  }
}

export function withRigNodeMissingHint(message: string, executable: string): string {
  const base = executable.toLowerCase().replaceAll('\\', '/').split('/').pop();
  if (base !== 'npm.cmd' && base !== 'npm' && base !== 'npm-cli.js') return message;
  if (!/"node" is not recognized/u.test(message)) return message;
  const hint =
    'Node.js was not found on PATH; reinstall Node.js or add its directory to PATH, then retry';
  if (message.includes(hint)) return message;
  return `${message}. ${hint}`;
}


export function createRigNpmRuntimeEnvironment(
  environment: NodeJS.ProcessEnv,
  runtimeExecutable: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const result = { ...environment };
  // Windows environment keys are case-insensitive. Keep only one PATH key so Node and
  // cross-spawn cannot choose a different inherited spelling.
  const pathKeys = Object.keys(result)
    .filter((key) => (platform === 'win32' ? key.toLowerCase() === 'path' : key === 'PATH'))
    .sort();
  const inheritedPath = result[pathKeys[0] ?? 'PATH'];
  for (const key of pathKeys) delete result[key];
  result.PATH = [platformPath.dirname(runtimeExecutable), inheritedPath]
    .filter(Boolean)
    .join(platformPath.delimiter);
  return result;
}

export function runRigPackageManagerCommand(
  command: RigPackageManagerCommand,
  environment: NodeJS.ProcessEnv = process.env,
  options: RigPackageManagerRunOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command.executable, [...command.args], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      notifyPackageManagerOutput(options, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk);
      notifyPackageManagerOutput(options, chunk);
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      const details = Buffer.concat([...stderr, ...stdout])
        .toString('utf8')
        .trim();
      reject(
        new Error(
          withRigNodeMissingHint(
            `${command.executable} failed (${
              signal ? `signal ${signal}` : `exit ${String(code)}`
            })${details ? `: ${details}` : ''}`,
            command.executable,
          ),
        ),
      );
    });
  });
}

function notifyPackageManagerOutput(options: RigPackageManagerRunOptions, chunk: Buffer): void {
  try {
    options.onOutput?.(chunk.toString('utf8'));
  } catch {
    // Progress rendering must never change the package-manager result.
  }
}

export function resolveRigPackageName(
  entryFile = process.argv[1],
): RigNpmPackageName | undefined {
  return resolveRigPackageIdentity(entryFile)?.packageName;
}

export function isInternalRigPackageName(packageName: string | undefined): boolean {
  return packageName === rigPackageName(RIG_INTERNAL_SCOPE);
}

export function resolveInstalledRigPackageVersion(
  entryFile = process.argv[1],
): string | undefined {
  return resolveRigPackageIdentity(entryFile)?.version;
}

export function resolveRigNpmPrefixInstall(
  entryFile = process.argv[1],
  platform: NodeJS.Platform = process.platform,
  nodeExecutable = process.execPath,
): RigNpmPrefixInstall | undefined {
  const identity = resolveRigPackageIdentity(entryFile);
  if (!identity) return undefined;
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const nodeModules = platformPath.dirname(platformPath.dirname(identity.packageRoot));
  if (platformPath.basename(nodeModules).toLocaleLowerCase() !== 'node_modules') return undefined;
  const nodeModulesParent = platformPath.dirname(nodeModules);
  const packagePrefix =
    platform !== 'win32' && platformPath.basename(nodeModulesParent) === 'lib'
      ? platformPath.dirname(nodeModulesParent)
      : nodeModulesParent;
  const receipt = findNpmPrefixReceipt(packagePrefix, identity.packageRoot, platform, platformPath);
  if (receipt) {
    if (receipt.packageName !== identity.packageName) return undefined;
    return receipt;
  }

  if (platformPath.basename(packagePrefix).toLocaleLowerCase() !== '.rig')
    return undefined;
  const adjacentNpm = platformPath.join(
    platformPath.dirname(nodeExecutable),
    platform === 'win32' ? 'npm.cmd' : 'npm',
  );
  if (!existsSync(adjacentNpm)) return undefined;
  const distribution = resolveRigNpmDistribution(identity.packageName);
  return {
    executable: adjacentNpm,
    packageName: identity.packageName,
    prefix: packagePrefix,
    registry: distribution.registry,
  };
}

function resolveRigPackageRoot(entryFile = process.argv[1]): string | undefined {
  return resolveRigPackageIdentity(entryFile)?.packageRoot;
}

function resolveRigPackageIdentity(
  entryFile: string | undefined,
): { packageName: RigNpmPackageName; packageRoot: string; version?: string } | undefined {
  if (!entryFile) return undefined;
  let current: string;
  try {
    const resolved = realpathSync(entryFile);
    current = statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  } catch {
    return undefined;
  }

  for (;;) {
    const manifestFile = path.join(current, 'package.json');
    if (existsSync(manifestFile)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
          name?: unknown;
          version?: unknown;
        };
        const packageName = parseRigPackageName(manifest.name);
        if (packageName) {
          // dist/ ships its own stamped package.json; it is not the install root.
          // Keep walking so packageRoot is the .../node_modules/<pkg> dir the
          // path classifiers match against.
          if (path.basename(current).toLocaleLowerCase() !== 'dist') {
            return {
              packageName,
              packageRoot: current,
              ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
            };
          }
        }
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function findNpmPrefixReceipt(
  packagePrefix: string,
  packageRoot: string,
  platform: NodeJS.Platform,
  platformPath: typeof path.posix | typeof path.win32,
): RigNpmPrefixInstall | undefined {
  let candidate = packagePrefix;
  for (let depth = 0; depth < 3; depth += 1) {
    const receipt = readNpmPrefixReceipt(
      candidate,
      packagePrefix,
      packageRoot,
      platform,
      platformPath,
    );
    if (receipt) return receipt;
    const parent = platformPath.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  return undefined;
}

function readNpmPrefixReceipt(
  prefix: string,
  packagePrefix: string,
  packageRoot: string,
  platform: NodeJS.Platform,
  platformPath: typeof path.posix | typeof path.win32,
): RigNpmPrefixInstall | undefined {
  try {
    const raw = readFileSync(platformPath.join(prefix, 'install.json'), 'utf8').replace(
      /^\uFEFF/u,
      '',
    );
    const value = JSON.parse(raw) as {
      schemaVersion?: unknown;
      product?: unknown;
      updateOwner?: unknown;
      packageManager?: unknown;
      packageName?: unknown;
      registry?: unknown;
      distTag?: unknown;
      prefix?: unknown;
      npmExecutable?: unknown;
      layoutVersion?: unknown;
      releasesDirectory?: unknown;
      currentFile?: unknown;
    };
    const packageName = parseRigPackageName(value.packageName);
    const legacyLayout = value.schemaVersion === 1 && value.layoutVersion === undefined;
    const versionedLayout =
      value.schemaVersion === 2 &&
      value.layoutVersion === 2 &&
      value.releasesDirectory === 'releases' &&
      value.currentFile === 'current';
    if (
      (!legacyLayout && !versionedLayout) ||
      value.product !== 'rig' ||
      value.updateOwner !== 'npm-prefix' ||
      value.packageManager !== 'npm' ||
      !packageName ||
      typeof value.registry !== 'string' ||
      value.distTag !== 'latest' ||
      typeof value.prefix !== 'string' ||
      typeof value.npmExecutable !== 'string'
    ) {
      return undefined;
    }
    const distribution = resolveRigNpmDistribution(packageName, value.registry);
    if (
      normalizeResolvedPath(value.prefix, platform) !== normalizeResolvedPath(prefix, platform) ||
      new URL(value.registry).href !== distribution.registry ||
      !existsSync(value.npmExecutable)
    ) {
      return undefined;
    }
    if (
      legacyLayout &&
      normalizeResolvedPath(packagePrefix, platform) !== normalizeResolvedPath(prefix, platform)
    ) {
      return undefined;
    }
    if (versionedLayout) {
      const expectedReleasesRoot = platformPath.join(prefix, 'releases');
      const relativeRelease = platformPath.relative(expectedReleasesRoot, packagePrefix);
      if (
        !relativeRelease ||
        relativeRelease.startsWith('..') ||
        platformPath.isAbsolute(relativeRelease) ||
        relativeRelease.includes(platformPath.sep) ||
        !/^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(relativeRelease) ||
        !isResolvedPathInside(packagePrefix, packageRoot, platformPath)
      ) {
        return undefined;
      }
    }
    return {
      executable: value.npmExecutable,
      packageName,
      prefix,
      registry: distribution.registry,
    };
  } catch {
    return undefined;
  }
}

function isResolvedPathInside(
  root: string,
  candidate: string,
  platformPath: typeof path.posix | typeof path.win32,
): boolean {
  const relative = platformPath.relative(
    platformPath.resolve(root),
    platformPath.resolve(candidate),
  );
  return relative !== '' && !relative.startsWith('..') && !platformPath.isAbsolute(relative);
}

function parseRigPackageName(value: unknown): RigNpmPackageName | undefined {
  if (value === rigPackageName(RIG_INTERNAL_SCOPE)) return value as RigNpmPackageName;
  if (value === rigPackageName(RIG_PUBLIC_SCOPE)) return value as RigNpmPackageName;
  return undefined;
}

function rigPackageName(scope: string): RigNpmPackageName {
  return `${scope}/${RIG_PACKAGE_BASENAME}` as RigNpmPackageName;
}

function rigPackageNameFromPath(packageRoot: string): RigNpmPackageName | undefined {
  const normalized = packageRoot.replaceAll('\\', '/');
  const segments = normalized.split('/');
  if (segments.at(-1) !== RIG_PACKAGE_BASENAME) return undefined;
  return parseRigPackageName(`${segments.at(-2)}/${RIG_PACKAGE_BASENAME}`);
}

function normalizeResolvedPath(value: string, platform: NodeJS.Platform): string {
  let resolved: string;
  try {
    resolved = realpathSync(value);
  } catch {
    resolved = (platform === 'win32' ? path.win32 : path.posix).resolve(value);
  }
  return platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

function runText(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, [...args], {
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8').trim());
        return;
      }
      const details = Buffer.concat([...stderr, ...stdout])
        .toString('utf8')
        .trim();
      reject(
        new Error(
          withRigNodeMissingHint(
            `${command} failed (${
              signal ? `signal ${signal}` : `exit ${String(code)}`
            })${details ? `: ${details}` : ''}`,
            command,
          ),
        ),
      );
    });
  });
}
