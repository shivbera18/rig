import { getRuntimeBuildEnv, type RigBuildEnv, type RigRegion } from '@rig/config';
import {
  resolveProductBuildIdentity,
  type ProductBuildIdentity,
} from '@rig/shared/product-build-identity';

export type TuiBuildEnvironment = 'test' | 'staging' | 'prod';
export type TuiBuildVariant = 'standard' | 'internal';
export type RigDataEnvironment = TuiBuildEnvironment | 'dev';

declare const __TUI_BUILD_ENV__: TuiBuildEnvironment | undefined;
declare const __TUI_BUILD_VARIANT__: TuiBuildVariant | undefined;

export interface ResolveRigAuthEnvironmentOptions {
  readonly embeddedBuildEnvironment?: TuiBuildEnvironment;
  readonly embeddedBuildVariant?: TuiBuildVariant;
  readonly runtimeRegion?: RigRegion;
  readonly runtimeBuildEnv?: RigBuildEnv;
}

export interface RigAuthEnvironment {
  readonly region: RigRegion;
  readonly buildEnv: RigBuildEnv;
}

let startupBuildEnvironment: TuiBuildEnvironment | undefined;

export function setRigStartupBuildEnvironment(
  environment: TuiBuildEnvironment | undefined,
): void {
  startupBuildEnvironment = environment;
}

export function resolveRigBuildIdentity(
  options: ResolveRigAuthEnvironmentOptions = {},
): ProductBuildIdentity {
  const embeddedBuildEnvironment =
    options.embeddedBuildEnvironment ?? readEmbeddedBuildEnvironment();
  const embeddedBuildVariant = options.embeddedBuildVariant ?? readEmbeddedBuildVariant();
  const runtimeBuildEnv = options.runtimeBuildEnv ?? getRuntimeBuildEnv();

  return resolveProductBuildIdentity({
    buildEnv: embeddedBuildEnvironment ?? normalizeRuntimeBuildEnvironment(runtimeBuildEnv),
    internalBuild: embeddedBuildVariant === 'internal',
  });
}

export function resolveRigAuthEnvironment(
  options: ResolveRigAuthEnvironmentOptions = {},
): RigAuthEnvironment {
  const buildIdentity = resolveRigBuildIdentity(options);

  return {
    region: options.runtimeRegion ?? 'cn',
    buildEnv: startupBuildEnvironment ?? buildIdentity.buildEnv ?? 'test',
  };
}

export function resolveRigDataEnvironment(
  embeddedBuildEnvironment: TuiBuildEnvironment | undefined = readEmbeddedBuildEnvironment(),
): RigDataEnvironment {
  return startupBuildEnvironment ?? embeddedBuildEnvironment ?? 'dev';
}

function readEmbeddedBuildEnvironment(): TuiBuildEnvironment | undefined {
  if (typeof __TUI_BUILD_ENV__ === 'undefined') return undefined;
  return __TUI_BUILD_ENV__;
}

function readEmbeddedBuildVariant(): TuiBuildVariant | undefined {
  if (typeof __TUI_BUILD_VARIANT__ === 'undefined') return undefined;
  return __TUI_BUILD_VARIANT__;
}

function normalizeRuntimeBuildEnvironment(environment: RigBuildEnv): RigBuildEnv {
  return environment === 'dev' ? 'test' : environment;
}
