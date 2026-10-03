import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { retryWindowsFileSystemOperation } from '@rig/shared';
import { resolveRigNpmDistribution } from './install-source.js';
import { readRigBinEntry, resolveRigPrefixPackageRoot } from './prefix-update.js';
import {
  RigUpdateCancelledError,
  reportRigUpdatePhase,
  throwIfRigUpdateCancelled,
  type RigUpdateOperationOptions,
} from './progress.js';
import {
  assertRigReleaseTargetAvailable,
  compareRigVersions,
  parseAndVerifyRigReleaseManifest,
  parseRigUpdateChannel,
  parseRigVersion,
  resolveRigReleaseTarget,
  type RigReleaseManifestV1,
  type RigUpdateChannel,
} from './release.js';

export { isManagedRigInstallRoot } from './install-source.js';

const DEFAULT_RELEASE_BASE_URL =
  'https://algeng-ali-shanghai-agent-02.oss-cn-shanghai.aliyuncs.com/' +
  'rig-dialogue/data/env/.npm-global/rig';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface RigUpdateRequest extends RigUpdateOperationOptions {
  channel?: string;
  version?: string;
  timeoutMs?: number;
}

export interface RigUpdateCheckResult {
  status: 'available' | 'current' | 'ahead';
  channel: RigUpdateChannel;
  currentVersion: string;
  latestVersion: string;
  manifest: RigReleaseManifestV1;
}

export interface RigUpdateApplyResult extends RigUpdateCheckResult {
  applied: boolean;
  installRoot: string;
}

export interface RigUpdateDependencies {
  fetchBytes(
    url: string,
    options?: { signal?: AbortSignal; proxyEnvironment?: NodeJS.ProcessEnv },
  ): Promise<Buffer>;
  installArtifact(input: {
    artifact: string;
    prefix: string;
    registry: string;
    proxyEnvironment: NodeJS.ProcessEnv;
  }): Promise<void>;
  validateInstalledVersion(prefix: string, version: string): Promise<void>;
}

export interface RigUpdateServiceOptions {
  currentVersion: string;
  installRoot?: string;
  releaseBaseUrl?: string;
  publicKey?: string;
  environment?: NodeJS.ProcessEnv;
  dependencies?: Partial<RigUpdateDependencies>;
}

export class RigUpdateService {
  private readonly currentVersion: string;
  private readonly installRoot: string;
  private readonly releaseBaseUrl: string;
  private readonly publicKey?: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly dependencies: RigUpdateDependencies;

  constructor(options: RigUpdateServiceOptions) {
    this.currentVersion = parseRigVersion(options.currentVersion);
    this.installRoot = options.installRoot ?? resolveRigInstallRoot(options.environment);
    this.releaseBaseUrl = (options.releaseBaseUrl ?? DEFAULT_RELEASE_BASE_URL).replace(/\/+$/u, '');
    this.publicKey = options.publicKey;
    this.environment = options.environment ?? process.env;
    this.dependencies = {
      fetchBytes: defaultFetchBytes,
      installArtifact: defaultInstallArtifact,
      validateInstalledVersion: defaultValidateInstalledVersion,
      ...options.dependencies,
    };
  }

  async check(request: RigUpdateRequest = {}): Promise<RigUpdateCheckResult> {
    throwIfRigUpdateCancelled(request.signal);
    reportRigUpdatePhase(request, 'checking', true);
    const channel = request.channel
      ? parseRigUpdateChannel(request.channel)
      : readRigUpdateChannel(this.installRoot);
    const version = request.version ? parseRigVersion(request.version) : undefined;
    const manifestUrl = version
      ? `${this.releaseBaseUrl}/releases/${encodeURIComponent(version)}/manifest.json`
      : `${this.releaseBaseUrl}/channels/${channel}.json`;
    const publicKey = this.publicKey ?? readInstalledPublicKey(this.installRoot, this.environment);
    const timeoutMs = normalizeTimeout(request.timeoutMs);
    const controller = new AbortController();
    const detachRequestAbort = forwardAbort(request.signal, controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error(`Rig update check timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    timeout.unref?.();
    try {
      const [manifestBytes, signatureBytes] = await Promise.all([
        this.dependencies.fetchBytes(manifestUrl, {
          signal: controller.signal,
          proxyEnvironment: this.environment,
        }),
        this.dependencies.fetchBytes(`${manifestUrl}.sig`, {
          signal: controller.signal,
          proxyEnvironment: this.environment,
        }),
      ]);
      const manifest = parseAndVerifyRigReleaseManifest(
        manifestBytes,
        signatureBytes.toString('utf8'),
        publicKey,
      );
      if (!version && manifest.channel !== channel) {
        throw new Error(
          `Signed Rig release channel mismatch: expected ${channel}, got ${manifest.channel}.`,
        );
      }
      if (version && manifest.version !== version) {
        throw new Error(
          `Signed Rig release version mismatch: expected ${version}, got ${manifest.version}.`,
        );
      }
      assertRigReleaseTargetAvailable(manifest, resolveRigReleaseTarget());
      const comparison = compareRigVersions(this.currentVersion, manifest.version);
      return {
        status: comparison < 0 ? 'available' : comparison > 0 ? 'ahead' : 'current',
        channel,
        currentVersion: this.currentVersion,
        latestVersion: manifest.version,
        manifest,
      };
    } catch (error) {
      if (request.signal?.aborted) throw new RigUpdateCancelledError();
      if (timedOut) {
        throw new Error(`Rig update check timed out after ${timeoutMs}ms.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      detachRequestAbort();
    }
  }

  async apply(request: RigUpdateRequest = {}): Promise<RigUpdateApplyResult> {
    const check = await this.check(request);
    if (check.status === 'current') {
      return { ...check, applied: false, installRoot: this.installRoot };
    }
    if (check.status === 'ahead' && !request.version) {
      throw new Error(
        `Installed Rig ${this.currentVersion} is newer than ${check.channel} ` +
          `${check.latestVersion}; pass --to to downgrade explicitly.`,
      );
    }

    const artifactTimeoutMs = normalizeTimeout(request.timeoutMs);
    throwIfRigUpdateCancelled(request.signal);
    reportRigUpdatePhase(request, 'downloading', true);
    const artifactController = new AbortController();
    const detachRequestAbort = forwardAbort(request.signal, artifactController);
    let artifactTimedOut = false;
    const artifactTimeout = setTimeout(() => {
      artifactTimedOut = true;
      artifactController.abort(
        new Error(`Rig artifact download timed out after ${artifactTimeoutMs}ms.`),
      );
    }, artifactTimeoutMs);
    artifactTimeout.unref?.();
    let artifactBytes: Buffer;
    try {
      artifactBytes = await this.dependencies.fetchBytes(check.manifest.installArtifact.url, {
        signal: artifactController.signal,
        proxyEnvironment: this.environment,
      });
    } catch (error) {
      if (request.signal?.aborted) throw new RigUpdateCancelledError();
      if (artifactTimedOut) {
        throw new Error(`Rig artifact download timed out after ${artifactTimeoutMs}ms.`, {
          cause: error,
        });
      }
      throw error;
    } finally {
      clearTimeout(artifactTimeout);
      detachRequestAbort();
    }
    throwIfRigUpdateCancelled(request.signal);
    verifyArtifact(artifactBytes, check.manifest);

    const versionsRoot = path.join(this.installRoot, 'versions');
    const finalPrefix = path.join(versionsRoot, check.latestVersion);
    const stagingPrefix = path.join(
      versionsRoot,
      `.staging-${check.latestVersion}-${process.pid}-${Date.now()}`,
    );
    const artifactFile = path.join(stagingPrefix, `rig-rig-${check.latestVersion}.tgz`);
    mkdirSync(stagingPrefix, { recursive: true });
    let createdFinalPrefix = false;
    try {
      reportRigUpdatePhase(request, 'staging', true);
      throwIfRigUpdateCancelled(request.signal);
      writeFileSync(artifactFile, artifactBytes, { mode: 0o600 });
      throwIfRigUpdateCancelled(request.signal);
      reportRigUpdatePhase(request, 'installing', false);
      await this.dependencies.installArtifact({
        artifact: artifactFile,
        prefix: stagingPrefix,
        registry: check.manifest.registry,
        proxyEnvironment: this.environment,
      });
      throwIfRigUpdateCancelled(request.signal);
      retryWindowsFileSystemOperation(() => rmSync(artifactFile, { force: true }));
      reportRigUpdatePhase(request, 'validating', false);
      await this.dependencies.validateInstalledVersion(stagingPrefix, check.latestVersion);
      throwIfRigUpdateCancelled(request.signal);
      reportRigUpdatePhase(request, 'activating', false);
      if (existsSync(finalPrefix)) {
        await this.dependencies.validateInstalledVersion(finalPrefix, check.latestVersion);
        removeUpdateTree(stagingPrefix);
      } else {
        retryWindowsFileSystemOperation(() => renameSync(stagingPrefix, finalPrefix));
        createdFinalPrefix = true;
      }
      activateVersion(this.installRoot, check.latestVersion);
      reportRigUpdatePhase(request, 'completed', false);
      return { ...check, applied: true, installRoot: this.installRoot };
    } catch (error) {
      removeUpdateTree(stagingPrefix);
      if (createdFinalPrefix && readActiveVersion(this.installRoot) !== check.latestVersion) {
        removeUpdateTree(finalPrefix);
      }
      if (error instanceof RigUpdateCancelledError || request.signal?.aborted) {
        throw new RigUpdateCancelledError();
      }
      throw new Error(
        `Rig ${check.latestVersion} was not activated; the previous version is unchanged: ${errorMessage(error)}`,
        { cause: error },
      );
    }
  }
}

export function resolveRigInstallRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.RIG_INSTALL_ROOT) return path.resolve(environment.RIG_INSTALL_ROOT);
  if (process.platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA;
    if (!localAppData)
      throw new Error('LOCALAPPDATA is required to resolve the Rig install root.');
    return path.join(localAppData, 'rig');
  }
  const dataHome = environment.XDG_DATA_HOME || path.join(homedir(), '.local', 'share');
  return path.join(dataHome, 'rig');
}

export function readRigUpdateChannel(installRoot: string): RigUpdateChannel {
  const file = path.join(installRoot, 'update.json');
  if (!existsSync(file)) return 'stable';
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Rig update channel config is invalid: ${errorMessage(error)}`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('channel' in parsed) ||
    typeof parsed.channel !== 'string'
  ) {
    throw new Error('Rig update channel config is missing channel.');
  }
  return parseRigUpdateChannel(parsed.channel);
}

function readInstalledPublicKey(installRoot: string, environment: NodeJS.ProcessEnv): string {
  const explicitFile = environment.RIG_RELEASE_PUBLIC_KEY_FILE;
  if (explicitFile) return readFileSync(path.resolve(explicitFile), 'utf8');
  const metadataFile = path.join(installRoot, 'install.json');
  if (!existsSync(metadataFile)) {
    throw new Error(
      'Rig update trust root is missing. Install with the official Shell/PowerShell installer first.',
    );
  }
  const metadata = JSON.parse(readFileSync(metadataFile, 'utf8')) as { publicKey?: unknown };
  if (typeof metadata.publicKey !== 'string' || !metadata.publicKey.includes('BEGIN PUBLIC KEY')) {
    throw new Error('Rig installer metadata does not contain a valid release public key.');
  }
  return metadata.publicKey;
}

function normalizeTimeout(value: number | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || value < 100 || value > 60_000) {
    throw new Error('Rig update timeout must be an integer between 100 and 60000 milliseconds.');
  }
  return value;
}

async function defaultFetchBytes(
  url: string,
  options: { signal?: AbortSignal; proxyEnvironment?: NodeJS.ProcessEnv } = {},
): Promise<Buffer> {
  const [{ default: undici }, { createTuiNetworkDispatcher }] = await Promise.all([
    import('undici'),
    import('../cli/network-proxy.js'),
  ]);
  const dispatcher = createTuiNetworkDispatcher(options.proxyEnvironment);
  try {
    const response = await undici.fetch(url, {
      signal: options.signal,
      dispatcher,
      redirect: 'error',
    });
    if (!response.ok) {
      throw new Error(`Rig release server returned HTTP ${response.status} for ${url}`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    await dispatcher.close();
  }
}

function resolveAdjacentOrShimNpm(): string {
  if (process.platform === 'win32') {
    try {
      const adjacent = process.execPath.replace(/node\.exe$/i, 'npm.cmd');
      if (existsSync(adjacent) && statSync(adjacent).isFile()) return adjacent;
    } catch {
      // Fall through to the PATH shim below.
    }
    return 'npm.cmd';
  }
  return 'npm';
}

async function defaultInstallArtifact(input: {
  artifact: string;
  prefix: string;
  registry: string;
  proxyEnvironment: NodeJS.ProcessEnv;
}): Promise<void> {
  const npm = resolveAdjacentOrShimNpm();
  await runRigUpdateCommand(
    npm,
    [
      'install',
      '--global',
      '--prefix',
      input.prefix,
      input.artifact,
      '--registry',
      input.registry,
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
    ],
    input.proxyEnvironment,
    true,
  );
}

async function defaultValidateInstalledVersion(prefix: string, version: string): Promise<void> {
  let executable = path.join(prefix, 'bin', 'rig');
  let args = ['--version'];
  if (process.platform === 'win32') {
    const packageRoot = resolveRigPrefixPackageRoot(
      prefix,
      resolveRigNpmDistribution().packageName,
    );
    const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const binEntry = readRigBinEntry(manifest.bin, 'rig');
    if (!binEntry || !existsSync(path.join(prefix, 'rig.cmd'))) {
      throw new Error(`Installed Rig launcher is missing or invalid at ${prefix}.`);
    }
    executable = process.execPath;
    args = [path.join(packageRoot, binEntry), '--version'];
  }
  const output = await runRigUpdateCommand(executable, args, process.env, true);
  if (output.trim() !== version) {
    throw new Error(`Installed Rig version mismatch: expected ${version}, got ${output.trim()}`);
  }
}

export function runRigUpdateCommand(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  capture = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      env: environment,
      shell: false,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
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
    child.once('close', (code, exitSignal) => {
      if (settled) return;
      settled = true;
      if (code === 0) return resolve(Buffer.concat(stdout).toString('utf8'));
      const details = Buffer.concat(stderr).toString('utf8').trim();
      reject(
        new Error(
          `${command} failed (${
            exitSignal ? `signal ${exitSignal}` : `exit ${String(code)}`
          })${details ? `: ${details}` : ''}`,
        ),
      );
    });
  });
}

function forwardAbort(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (!signal) return () => undefined;
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function verifyArtifact(bytes: Buffer, manifest: RigReleaseManifestV1): void {
  if (bytes.length !== manifest.installArtifact.size) {
    throw new Error(
      `Rig artifact checksum/size verification failed: expected ` +
        `${manifest.installArtifact.size} bytes, got ${bytes.length}.`,
    );
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== manifest.installArtifact.sha256) {
    throw new Error('Rig artifact checksum verification failed.');
  }
}

function activateVersion(installRoot: string, version: string): void {
  mkdirSync(installRoot, { recursive: true });
  const current = path.join(installRoot, 'current');
  const temporary = `${current}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${version}\n`, { mode: 0o600 });
  retryWindowsFileSystemOperation(() => renameSync(temporary, current));
}

function removeUpdateTree(target: string): void {
  rmSync(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 50 });
}

function readActiveVersion(installRoot: string): string | undefined {
  const current = path.join(installRoot, 'current');
  if (!existsSync(current)) return undefined;
  return readFileSync(current, 'utf8').trim() || undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
