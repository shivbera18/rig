import { createPublicKey, verify } from 'node:crypto';

export type RigUpdateChannel = 'stable' | 'preview';
export type RigReleaseTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'linux-x64'
  | 'windows-x64'
  | 'windows-arm64';

export interface RigReleaseArtifact {
  url: string;
  sha256: string;
  size: number;
}

type RigReleaseTargetArtifact = Omit<RigReleaseArtifact, 'url'>;
type RigReleaseManifestV1Targets = Record<
  Exclude<RigReleaseTarget, 'windows-arm64'>,
  RigReleaseTargetArtifact
> &
  Partial<Record<'windows-arm64', RigReleaseTargetArtifact>>;

export interface RigReleaseManifestV1 {
  schemaVersion: 1;
  product: 'rig';
  channel: RigUpdateChannel | string;
  version: string;
  publishedAt: string;
  minNodeVersion: string;
  registry: string;
  installArtifact: RigReleaseArtifact;
  targets: RigReleaseManifestV1Targets;
}

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CHANNEL_PATTERN = /^(?:stable|preview)$/u;
const REQUIRED_V1_TARGETS = [
  'darwin-arm64',
  'darwin-x64',
  'linux-x64',
  'windows-x64',
] as const satisfies readonly RigReleaseTarget[];
const TARGETS = [...REQUIRED_V1_TARGETS, 'windows-arm64'] as const;

export function parseRigUpdateChannel(value: string): RigUpdateChannel {
  if (!CHANNEL_PATTERN.test(value)) {
    throw new Error(`Unsupported Rig update channel: ${JSON.stringify(value)}`);
  }
  return value as RigUpdateChannel;
}

export function parseRigVersion(value: string): string {
  if (!VERSION_PATTERN.test(value)) {
    throw new Error(`Invalid Rig version: ${JSON.stringify(value)}`);
  }
  return value;
}

export function parseAndVerifyRigReleaseManifest(
  manifestBytes: Uint8Array,
  signatureText: string,
  publicKeyPem: string,
): RigReleaseManifestV1 {
  const signature = readBase64Signature(signatureText);
  let authentic = false;
  try {
    authentic = verify(null, manifestBytes, createPublicKey(publicKeyPem), signature);
  } catch (error) {
    throw new Error(`Rig release signature could not be verified: ${errorMessage(error)}`);
  }
  if (!authentic) throw new Error('Rig release signature verification failed.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(manifestBytes).toString('utf8'));
  } catch (error) {
    throw new Error(`Rig release manifest is not valid JSON: ${errorMessage(error)}`);
  }
  return validateManifest(parsed);
}

function validateManifest(value: unknown): RigReleaseManifestV1 {
  if (!isRecord(value)) throw new Error('Rig release manifest must be an object.');
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported Rig release schema: ${String(value.schemaVersion)}`);
  }
  if (value.product !== 'rig') {
    throw new Error(`Unexpected release product: ${String(value.product)}`);
  }
  const channel =
    typeof value.channel === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]*$/u.test(value.channel)
      ? value.channel
      : undefined;
  if (!channel) throw new Error('Rig release channel is invalid.');
  const version = typeof value.version === 'string' ? parseRigVersion(value.version) : undefined;
  if (!version) throw new Error('Rig release version is missing.');
  if (typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) {
    throw new Error('Rig release publishedAt is invalid.');
  }
  if (typeof value.minNodeVersion !== 'string' || !/^\d+\.\d+\.\d+$/u.test(value.minNodeVersion)) {
    throw new Error('Rig release minNodeVersion is invalid.');
  }
  const registry = readHttpsUrl(value.registry, 'registry');
  const installArtifact = readArtifact(value.installArtifact, true, 'installArtifact');
  if (!isRecord(value.targets)) throw new Error('Rig release targets are missing.');
  const targets: RigReleaseManifestV1Targets = {
    'darwin-arm64': readArtifact(value.targets['darwin-arm64'], false, 'targets.darwin-arm64'),
    'darwin-x64': readArtifact(value.targets['darwin-x64'], false, 'targets.darwin-x64'),
    'linux-x64': readArtifact(value.targets['linux-x64'], false, 'targets.linux-x64'),
    'windows-x64': readArtifact(value.targets['windows-x64'], false, 'targets.windows-x64'),
  };
  if (value.targets['windows-arm64'] !== undefined) {
    targets['windows-arm64'] = readArtifact(
      value.targets['windows-arm64'],
      false,
      'targets.windows-arm64',
    );
  }
  return {
    schemaVersion: 1,
    product: 'rig',
    channel,
    version,
    publishedAt: value.publishedAt,
    minNodeVersion: value.minNodeVersion,
    registry,
    installArtifact,
    targets,
  };
}

function readArtifact(value: unknown, includeUrl: true, name: string): RigReleaseArtifact;
function readArtifact(
  value: unknown,
  includeUrl: false,
  name: string,
): Omit<RigReleaseArtifact, 'url'>;
function readArtifact(
  value: unknown,
  includeUrl: boolean,
  name: string,
): RigReleaseArtifact | Omit<RigReleaseArtifact, 'url'> {
  if (!isRecord(value)) throw new Error(`${name} is missing.`);
  if (typeof value.sha256 !== 'string' || !SHA256_PATTERN.test(value.sha256)) {
    throw new Error(`${name}.sha256 is invalid.`);
  }
  if (!Number.isSafeInteger(value.size) || (value.size as number) <= 0) {
    throw new Error(`${name}.size is invalid.`);
  }
  const base = { sha256: value.sha256, size: value.size as number };
  return includeUrl ? { ...base, url: readHttpsUrl(value.url, `${name}.url`) } : base;
}

function readHttpsUrl(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be an HTTPS URL.`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${name} must be an HTTPS URL without embedded credentials.`);
  }
  return url.href;
}

function readBase64Signature(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)) {
    throw new Error('Rig release signature is not valid base64.');
  }
  const signature = Buffer.from(normalized, 'base64');
  if (signature.length !== 64) throw new Error('Rig release signature has an invalid length.');
  return signature;
}

export function resolveRigReleaseTarget(
  platform = process.platform,
  arch = process.arch,
): RigReleaseTarget {
  const candidate = `${platform === 'win32' ? 'windows' : platform}-${arch}`;
  if ((TARGETS as readonly string[]).includes(candidate)) {
    return candidate as RigReleaseTarget;
  }
  throw new Error(`Unsupported Rig update host: ${platform}-${arch}`);
}

export function assertRigReleaseTargetAvailable(
  manifest: RigReleaseManifestV1,
  target: RigReleaseTarget,
): void {
  if (manifest.targets[target]) return;
  throw new Error(`Rig ${manifest.version} does not provide a release for ${target}.`);
}

interface ParsedVersion {
  core: number[];
  prerelease: Array<number | string>;
}

function parsedVersion(value: string): ParsedVersion {
  parseRigVersion(value);
  const [coreText = '', prereleaseText] = value.split('-', 2);
  return {
    core: coreText.split('.').map((part) => Number.parseInt(part, 10)),
    prerelease: prereleaseText
      ? prereleaseText.split('.').map((part) => (/^\d+$/u.test(part) ? Number(part) : part))
      : [],
  };
}

export function compareRigVersions(left: string, right: string): number {
  const leftVersion = parsedVersion(left);
  const rightVersion = parsedVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (difference !== 0) return difference;
  }
  if (leftVersion.prerelease.length === 0 && rightVersion.prerelease.length > 0) return 1;
  if (rightVersion.prerelease.length === 0 && leftVersion.prerelease.length > 0) return -1;
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'number' && typeof rightPart === 'number') return leftPart - rightPart;
    if (typeof leftPart === 'number') return -1;
    if (typeof rightPart === 'number') return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
