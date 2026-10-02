import type { RigBuildEnv, RigRegion } from '@rig/config';
import type {
  AuthStatusSnapshot,
  DeviceAuthorizationPrompt,
  LoginOptions,
  LoginResult,
  LogoutResult,
} from '@rig/oauth-core';

import type {
  RigBusinessEventMap,
  RigBusinessTelemetry,
  RigLoginFailReason,
  RigLoginSource,
} from '../analytics/business-telemetry.js';
import { resolveRigAuthEnvironment } from './environment.js';
import { buildRigLogoutUrl } from './logout-url.js';

export type RigAuthProgress = {
  readonly state: 'device-authorization';
} & DeviceAuthorizationPrompt;

export interface RigAuthResult {
  readonly state: 'already-authenticated' | 'authenticated' | 'already-signed-out' | 'signed-out';
  readonly message: string;
  readonly restartRequired?: boolean;
  readonly logoutUrl?: string;
}

export interface RigAuthPort {
  login(
    onProgress?: (progress: RigAuthProgress) => void,
    region?: RigRegion,
  ): Promise<RigAuthResult>;
  logout(): Promise<RigAuthResult>;
}

export interface RigSharedAuthCore {
  getStatus(): Promise<AuthStatusSnapshot>;
  login(options?: LoginOptions): Promise<LoginResult>;
  logout(options: { revoke: boolean }): Promise<LogoutResult>;
}

export interface RigAuthApplicationOptions {
  readonly dataDir: string;
  readonly sharedAuthCore: RigSharedAuthCore;
  readonly resolveSharedAuthCore?: (region: RigRegion) => RigSharedAuthCore;
  readonly region?: RigRegion;
  readonly buildEnv?: RigBuildEnv;
  readonly telemetry?: RigBusinessTelemetry;
  readonly telemetrySource?: RigLoginSource;
  readonly writeRegionPreference?: (
    dataDir: string,
    preference: { region: RigRegion; buildEnv: RigBuildEnv },
  ) => unknown;
}

export class RigAuthApplication implements RigAuthPort {
  private readonly scope: { region: RigRegion; buildEnv: RigBuildEnv };

  constructor(private readonly options: RigAuthApplicationOptions) {
    const environment = resolveRigAuthEnvironment({
      runtimeRegion: process.env.RIG_REGION === 'en' ? 'en' : 'cn',
    });
    this.scope = {
      region: options.region ?? environment.region,
      buildEnv: options.buildEnv ?? environment.buildEnv,
    };
  }

  async login(
    onProgress?: (progress: RigAuthProgress) => void,
    region: RigRegion = this.scope.region,
  ): Promise<RigAuthResult> {
    this.track('login_click', {});
    try {
      const requestedScope = { ...this.scope, region };
      const switchesRegion = !isSameScope(requestedScope, this.scope);
      let sharedAuthCore = this.options.sharedAuthCore;
      if (switchesRegion) {
        if (!this.options.resolveSharedAuthCore) {
          throw new Error(formatEnvironmentConflict(this.scope, requestedScope));
        }
        sharedAuthCore = this.options.resolveSharedAuthCore(region);
      }
      const wasAuthenticated = (await sharedAuthCore.getStatus()).status === 'authenticated';
      let deviceFlowStarted = false;
      await sharedAuthCore.login({
        onDeviceAuthorization: (authorization: DeviceAuthorizationPrompt) => {
          deviceFlowStarted = true;
          onProgress?.({ state: 'device-authorization', ...authorization });
        },
      });
      this.persistRegionPreference(requestedScope);
      const alreadyAuthenticated = wasAuthenticated && !deviceFlowStarted;
      const result = {
        state: alreadyAuthenticated
          ? ('already-authenticated' as const)
          : ('authenticated' as const),
        message: alreadyAuthenticated
          ? switchesRegion
            ? `Already signed in with ${formatRegion(requestedScope.region)}.`
            : 'Already signed in with Rig.'
          : switchesRegion
            ? `Signed in with ${formatRegion(requestedScope.region)}.`
            : 'Signed in with Rig.',
        ...(switchesRegion ? { restartRequired: true as const } : {}),
      };
      this.trackLoginResult('1', '');
      return result;
    } catch (error) {
      this.trackLoginResult('2', classifyLoginFailure(error));
      throw error;
    }
  }

  async logout(): Promise<RigAuthResult> {
    this.track('logout_click', {});
    const status = await this.options.sharedAuthCore.getStatus();
    // Always run the shared logout: signing out while already signed out is a
    // safe no-op in the core, and never blocking /logout keeps a wedged local
    // state recoverable.
    const result = await this.options.sharedAuthCore.logout({ revoke: true });
    const logoutUrl = buildRigLogoutUrl(this.scope);
    if (status.status === 'anonymous' && result.status === 'anonymous') {
      return { state: 'already-signed-out', message: 'Already signed out of Rig.', logoutUrl };
    }
    return {
      state: 'signed-out',
      logoutUrl,
      message:
        result.status === 'logout_pending'
          ? `Signed out locally from ${formatRegion(this.scope.region)} across Rig. Server revocation is pending until the network recovers.`
          : `Signed out of ${formatRegion(this.scope.region)} on Desktop, CLI/TUI, and embedded rig-tools.`,
    };
  }

  private trackLoginResult(resultType: '1' | '2', failReason: RigLoginFailReason): void {
    this.track('login_result', {
      source: this.options.telemetrySource ?? 'rig_cli',
      result_type: resultType,
      fail_reason: failReason,
      login_type: 'rig_oauth',
    });
  }

  private persistRegionPreference(scope: { region: RigRegion; buildEnv: RigBuildEnv }): void {
    try {
      this.options.writeRegionPreference?.(this.options.dataDir, scope);
    } catch {
      // Region persistence must not invalidate an already completed OAuth login.
    }
  }

  private track<Event extends 'login_click' | 'logout_click' | 'login_result'>(
    event: Event,
    properties: RigBusinessEventMap[Event],
  ): void {
    try {
      this.options.telemetry?.track(event, properties);
    } catch {
      // Business telemetry must not affect authentication.
    }
  }
}

function classifyLoginFailure(error: unknown): RigLoginFailReason {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancel/iu.test(message)) return '3';
  if (/network|offline|fetch|ECONN|ENOTFOUND|ETIMEDOUT/iu.test(message)) return '2';
  if (/oauth|authorization|login failed|invalid login state/iu.test(message)) return '5';
  if (/server|HTTP 5\d\d/iu.test(message)) return '1';
  return '4';
}

function isSameScope(
  left: { region: RigRegion; buildEnv: RigBuildEnv },
  right: { region: RigRegion; buildEnv: RigBuildEnv },
): boolean {
  return left.region === right.region && left.buildEnv === right.buildEnv;
}

function formatEnvironmentConflict(
  active: { region: RigRegion; buildEnv: RigBuildEnv },
  requested: { region: RigRegion; buildEnv: RigBuildEnv },
): string {
  if (active.region !== requested.region) {
    return `Signed in to ${formatRegion(active.region)}. Run \`rig logout\` before signing in to ${formatRegion(requested.region)}.`;
  }
  return `Signed in to another Rig ${active.buildEnv} environment. Run \`rig logout\` before signing in to ${requested.buildEnv}.`;
}

function formatRegion(region: RigRegion): string {
  return region === 'cn' ? 'Rig China' : 'Rig Global';
}
