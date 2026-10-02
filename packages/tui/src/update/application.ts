import {
  RigUpdateService,
  resolveRigInstallRoot,
  type RigUpdateApplyResult,
  type RigUpdateCheckResult,
  type RigUpdateRequest,
} from './service.js';
import {
  buildRigPackageManagerCommand,
  bindRigNpmCommandToRuntime,
  createRigNpmRuntimeEnvironment,
  detectRigInstallSource,
  resolveRigNpmDistribution,
  resolveRigNpmDistTag,
  resolveRigNpmPrefixInstall,
  resolveInstalledRigPackageVersion,
  resolveLatestRigRegistryVersion,
  runRigPackageManagerCommand,
  type RigInstallSource,
  type RigNpmDistTag,
  type RigNpmDistribution,
  type RigNpmPackageName,
  type RigNpmPrefixInstall,
  type RigPackageManagerCommand,
  type RigPackageManagerInstallSource,
  type RigPackageManagerRunOptions,
} from './install-source.js';
import { compareRigVersions } from './release.js';
import { reportRigUpdatePhase } from './progress.js';
import {
  rigPrefixNonPrefixPlanMessage,
  rigPrefixNotStagedMessage,
  rigPrefixOwnershipMissingMessage,
  rigPrefixPendingActivationMessage,
  rigPrefixPendingCleanupMessage,
  rigPrefixVersionedInstalledMessage,
  rigPrefixStagedVersionMismatchMessage,
} from './messages.js';
import {
  countRigPrefixUpdateBlockers,
  inspectPendingRigPrefixUpdate,
  readRigPrefixPackageMetadata,
  removeRigPrefixUpdateStaging,
  validateRigPrefixPackage,
  type RigPrefixPackageMetadata,
} from './prefix-update.js';
import {
  acquireRigVersionedPrefixUpdateLock,
  activateRigVersionedPrefixInstall,
  createRigVersionedPrefixStagingPrefix,
  prepareRigVersionedPrefixStaging,
  type RigVersionedPrefixActivation,
} from './versioned-prefix.js';

interface ManagedUpdateService {
  check(request?: RigUpdateRequest): Promise<RigUpdateCheckResult>;
  apply(request?: RigUpdateRequest): Promise<RigUpdateApplyResult>;
}

interface RigManagedUpdatePlan {
  readonly source: 'managed-installer';
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly channel: 'stable' | 'preview';
}

interface RigPackageManagerVersionPlan {
  readonly source: RigPackageManagerInstallSource;
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly packageTag: RigNpmDistTag;
}

export type RigUpdatePlan =
  | (RigManagedUpdatePlan & { readonly kind: 'current' })
  | (RigManagedUpdatePlan & { readonly kind: 'ahead' })
  | (RigManagedUpdatePlan & { readonly kind: 'available' })
  | (RigPackageManagerVersionPlan & { readonly kind: 'current' })
  | (RigPackageManagerVersionPlan & { readonly kind: 'ahead' })
  | {
      readonly kind: 'package-manager';
      readonly source: RigPackageManagerInstallSource;
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly packageTag: RigNpmDistTag;
      readonly command: RigPackageManagerCommand;
    }
  | {
      readonly kind: 'manual';
      readonly source: 'unsupported';
      readonly currentVersion: string;
      readonly command: string;
    };

export interface RigUpdateOutcome {
  readonly applied: boolean;
  readonly message: string;
  readonly restartRequired?: boolean;
}

export type RigUpdateApplyOptions = RigPackageManagerRunOptions;

export interface RigUpdateApplicationOptions {
  readonly currentVersion: string;
  readonly installRoot?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly packageTag?: RigNpmDistTag;
  readonly packageName?: RigNpmPackageName;
  readonly prefixInstall?: RigNpmPrefixInstall;
  readonly entryFile?: string;
  readonly runtimeExecutable?: string;
}

export interface RigUpdateApplicationDependencies {
  readonly detectInstallSource: () => Promise<RigInstallSource>;
  readonly createManagedService: () => ManagedUpdateService;
  readonly resolveLatestPackageVersion: (tag: RigNpmDistTag) => Promise<string>;
  readonly runPackageManager: (
    command: RigPackageManagerCommand,
    options?: RigPackageManagerRunOptions,
  ) => Promise<void>;
  readonly readInstalledPackageVersion: () => string | undefined;
  readonly readPrefixPackageMetadata: (
    prefix: string,
    packageName: RigNpmPackageName,
  ) => RigPrefixPackageMetadata;
  readonly validatePrefixPackage: (
    prefix: string,
    metadata: RigPrefixPackageMetadata,
    expectedVersion: string,
  ) => Promise<void>;
  readonly countPrefixUpdateBlockers: (activePrefix: string) => number | undefined;
  readonly removePrefixStaging: (stagingPrefix: string) => void;
  readonly createVersionedPrefixStaging: (prefix: string, version: string) => string;
  readonly prepareVersionedPrefixStaging: (stagingPrefix: string) => void;
  readonly activateVersionedPrefix: (activation: RigVersionedPrefixActivation) => string;
  readonly acquirePrefixUpdateLock: (activePrefix: string) => () => void;
}

export class RigUpdateApplication {
  private readonly currentVersion: string;
  private readonly packageTag: RigNpmDistTag;
  private readonly distribution: RigNpmDistribution;
  private readonly platform: NodeJS.Platform;
  private readonly prefixInstall?: RigNpmPrefixInstall;
  private readonly entryFile?: string;
  private readonly runtimeExecutable: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly dependencies: RigUpdateApplicationDependencies;

  constructor(
    options: RigUpdateApplicationOptions,
    dependencies: Partial<RigUpdateApplicationDependencies> = {},
  ) {
    this.currentVersion = options.currentVersion;
    const environment = options.environment ?? process.env;
    const installRoot = options.installRoot ?? resolveRigInstallRoot(environment);
    const platform = options.platform ?? process.platform;
    this.platform = platform;
    this.environment = environment;
    this.entryFile = options.entryFile ?? process.argv[1];
    this.runtimeExecutable = options.runtimeExecutable ?? process.execPath;
    this.prefixInstall =
      options.prefixInstall ?? resolveRigNpmPrefixInstall(this.entryFile, platform);
    const packageManagerEnvironment = this.prefixInstall
      ? createRigNpmRuntimeEnvironment(environment, this.runtimeExecutable, platform)
      : environment;
    this.packageTag = options.packageTag ?? resolveRigNpmDistTag();
    this.distribution = resolveRigNpmDistribution(
      options.packageName,
      this.prefixInstall?.registry,
    );
    this.dependencies = {
      detectInstallSource:
        dependencies.detectInstallSource ??
        (() =>
          detectRigInstallSource({
            installRoot,
            platform,
            prefixInstall: () => this.prefixInstall,
          })),
      createManagedService:
        dependencies.createManagedService ??
        (() =>
          new RigUpdateService({
            currentVersion: options.currentVersion,
            installRoot,
            environment,
          })),
      resolveLatestPackageVersion:
        dependencies.resolveLatestPackageVersion ??
        ((tag) =>
          resolveLatestRigRegistryVersion(tag, {
            platform,
            distribution: this.distribution,
            environment: packageManagerEnvironment,
            ...(this.prefixInstall
              ? {
                  npmExecutable: this.prefixInstall.executable,
                  runtimeExecutable: this.runtimeExecutable,
                }
              : {}),
          })),
      runPackageManager:
        dependencies.runPackageManager ??
        ((command, progress) =>
          runRigPackageManagerCommand(
            this.prefixInstall
              ? bindRigNpmCommandToRuntime(command, this.runtimeExecutable)
              : command,
            packageManagerEnvironment,
            progress,
          )),
      readInstalledPackageVersion:
        dependencies.readInstalledPackageVersion ?? resolveInstalledRigPackageVersion,
      readPrefixPackageMetadata:
        dependencies.readPrefixPackageMetadata ??
        ((prefix, packageName) => readRigPrefixPackageMetadata(prefix, packageName, platform)),
      validatePrefixPackage:
        dependencies.validatePrefixPackage ??
        ((prefix, metadata, expectedVersion) =>
          validateRigPrefixPackage(prefix, metadata, this.runtimeExecutable, expectedVersion)),
      countPrefixUpdateBlockers:
        dependencies.countPrefixUpdateBlockers ?? countRigPrefixUpdateBlockers,
      removePrefixStaging: dependencies.removePrefixStaging ?? removeRigPrefixUpdateStaging,
      createVersionedPrefixStaging:
        dependencies.createVersionedPrefixStaging ??
        ((prefix, version) => createRigVersionedPrefixStagingPrefix(prefix, version, platform)),
      prepareVersionedPrefixStaging:
        dependencies.prepareVersionedPrefixStaging ?? prepareRigVersionedPrefixStaging,
      activateVersionedPrefix:
        dependencies.activateVersionedPrefix ??
        ((activation) => activateRigVersionedPrefixInstall(activation, platform)),
      acquirePrefixUpdateLock:
        dependencies.acquirePrefixUpdateLock ?? acquireRigVersionedPrefixUpdateLock,
    };
  }

  async inspect(): Promise<RigUpdatePlan> {
    const source = await this.dependencies.detectInstallSource();
    if (source === 'managed-installer') {
      const result = await this.dependencies.createManagedService().check();
      return {
        kind: result.status,
        source,
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        channel: result.channel,
      };
    }
    if (source === 'unsupported') {
      return {
        kind: 'manual',
        source,
        currentVersion: this.currentVersion,
        command: buildRigPackageManagerCommand(
          'npm-global',
          this.packageTag,
          this.platform,
          this.distribution,
        ).display,
      };
    }
    const pendingUpdate =
      source === 'npm-prefix' ? inspectPendingRigPrefixUpdate(this.entryFile) : undefined;
    if (pendingUpdate) {
      const latestVersion = pendingUpdate.activation.expectedVersion;
      return {
        kind: 'package-manager',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
        command: buildRigPackageManagerCommand(
          source,
          latestVersion,
          this.platform,
          this.distribution,
          this.prefixInstall,
        ),
      };
    }
    const latestVersion = await this.dependencies.resolveLatestPackageVersion(this.packageTag);
    const comparison = compareRigVersions(this.currentVersion, latestVersion);
    const followsRollingTag = this.packageTag !== 'latest';
    if (comparison === 0) {
      return {
        kind: 'current',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
      };
    }
    if (comparison > 0 && !followsRollingTag) {
      return {
        kind: 'ahead',
        source,
        currentVersion: this.currentVersion,
        latestVersion,
        packageTag: this.packageTag,
      };
    }
    return {
      kind: 'package-manager',
      source,
      currentVersion: this.currentVersion,
      latestVersion,
      packageTag: this.packageTag,
      command: buildRigPackageManagerCommand(
        source,
        latestVersion,
        this.platform,
        this.distribution,
        this.prefixInstall,
      ),
    };
  }

  async apply(
    plan: RigUpdatePlan,
    options: RigUpdateApplyOptions = {},
  ): Promise<RigUpdateOutcome> {
    if (plan.kind === 'manual' || plan.kind === 'current' || plan.kind === 'ahead') {
      throw new Error(`Rig update plan ${plan.kind} cannot be applied automatically.`);
    }
    if (plan.kind === 'available') {
      const result = await this.dependencies.createManagedService().apply({
        channel: plan.channel,
        version: plan.latestVersion,
        ...options,
      });
      return result.applied
        ? {
            applied: true,
            message:
              `Rig ${result.latestVersion} is installed. ` +
              'Restart running Rig sessions to use it.',
          }
        : {
            applied: false,
            message: `Rig ${result.currentVersion} is already active.`,
          };
    }

    if (plan.source === 'npm-prefix') {
      return this.applyNpmPrefixUpdate(plan, options);
    }

    reportRigUpdatePhase(options, 'installing', false);
    await this.dependencies.runPackageManager(plan.command, options);
    const installedVersion = this.dependencies.readInstalledPackageVersion();
    if (installedVersion !== plan.latestVersion) {
      throw new Error(
        `Rig update installed ${installedVersion || '<unknown>'}; expected ${plan.latestVersion}.`,
      );
    }
    reportRigUpdatePhase(options, 'completed', false);
    return {
      applied: true,
      message:
        `Rig ${plan.latestVersion} was installed through ${packageManagerName(plan.source)}. ` +
        'Restart Rig to use the installed version.',
    };
  }

  private async applyNpmPrefixUpdate(
    plan: Extract<RigUpdatePlan, { kind: 'package-manager' }>,
    options: RigUpdateApplyOptions,
  ): Promise<RigUpdateOutcome> {
    if (plan.source !== 'npm-prefix') {
      throw new Error(rigPrefixNonPrefixPlanMessage(this.environment));
    }
    const prefixInstall = this.prefixInstall;
    if (!prefixInstall) {
      throw new Error(rigPrefixOwnershipMissingMessage(this.environment));
    }
    const pendingUpdate = inspectPendingRigPrefixUpdate(this.entryFile);
    if (pendingUpdate) {
      const blockingSessionCount = this.dependencies.countPrefixUpdateBlockers(
        pendingUpdate.activation.activePrefix,
      );
      return {
        applied: false,
        restartRequired: true,
        message:
          pendingUpdate.state === 'activated'
            ? rigPrefixPendingCleanupMessage(pendingUpdate.activation.expectedVersion, {
                blockingSessionCount,
                environment: this.environment,
              })
            : rigPrefixPendingActivationMessage(pendingUpdate.activation.expectedVersion, {
                blockingSessionCount,
                environment: this.environment,
              }),
      };
    }
    const releaseLock = this.dependencies.acquirePrefixUpdateLock(prefixInstall.prefix);
    let stagingPrefix: string | undefined;
    try {
      stagingPrefix = this.dependencies.createVersionedPrefixStaging(
        prefixInstall.prefix,
        plan.latestVersion,
      );
      const stagedCommand = buildRigPackageManagerCommand(
        'npm-prefix',
        plan.latestVersion,
        this.platform,
        this.distribution,
        { ...prefixInstall, prefix: stagingPrefix },
      );
      reportRigUpdatePhase(options, 'staging', true);
      this.dependencies.prepareVersionedPrefixStaging(stagingPrefix);
      reportRigUpdatePhase(options, 'installing', false);
      await this.dependencies.runPackageManager(stagedCommand, options);
      reportRigUpdatePhase(options, 'validating', false);
      const stagedPackage = this.dependencies.readPrefixPackageMetadata(
        stagingPrefix,
        prefixInstall.packageName,
      );
      if (stagedPackage.version !== plan.latestVersion) {
        throw new Error(
          rigPrefixStagedVersionMismatchMessage(
            stagedPackage.version,
            plan.latestVersion,
            this.environment,
          ),
        );
      }
      await this.dependencies.validatePrefixPackage(
        stagingPrefix,
        stagedPackage,
        plan.latestVersion,
      );
      reportRigUpdatePhase(options, 'activating', false);
      this.dependencies.activateVersionedPrefix({
        stagingPrefix,
        activePrefix: prefixInstall.prefix,
        packageName: prefixInstall.packageName,
        expectedVersion: plan.latestVersion,
        runtimeExecutable: this.runtimeExecutable,
        npmExecutable: prefixInstall.executable,
        registry: prefixInstall.registry,
      });
      reportRigUpdatePhase(options, 'completed', false);
      return {
        applied: true,
        restartRequired: false,
        message: rigPrefixVersionedInstalledMessage(plan.latestVersion, this.environment),
      };
    } catch (error) {
      if (stagingPrefix) this.dependencies.removePrefixStaging(stagingPrefix);
      throw new Error(
        rigPrefixNotStagedMessage(plan.latestVersion, errorMessage(error), this.environment),
        { cause: error },
      );
    } finally {
      releaseLock();
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function packageManagerName(source: RigPackageManagerInstallSource): string {
  if (source === 'npm-prefix') return 'npm';
  return source.replace('-global', '');
}
