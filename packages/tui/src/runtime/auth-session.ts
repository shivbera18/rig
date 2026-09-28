import type { RigBuildEnv, RigRegion } from '@rig/config';
import {
  createAuthNamespace,
  createCredentialStore,
  HttpOAuthClient,
  migrateLegacyAuthNamespace,
  MCodeOAuthCore,
  type HttpOAuthClientOptions,
  type OAuthClient,
} from '@rig/oauth-core';

export interface CreateMcodeSharedAuthSessionOptions {
  dataDir: string;
  region: RigRegion;
  buildEnv: RigBuildEnv;
  oauthClient?: OAuthClient;
  oauthEndpoints?: Pick<
    HttpOAuthClientOptions,
    'deviceAuthorizationEndpoint' | 'tokenEndpoint' | 'revocationEndpoint'
  >;
}

export function createMcodeSharedAuthSession(
  options: CreateMcodeSharedAuthSessionOptions,
): MCodeOAuthCore {
  const namespace = createAuthNamespace({
    dataDir: options.dataDir,
    buildEnv: options.buildEnv,
    region: options.region,
  });
  const oauthClient = options.oauthClient ?? createHttpOAuthClient(options.oauthEndpoints);
  const credentialStore = createCredentialStore({ authHome: namespace.namespaceHome });
  return new MCodeOAuthCore({
    namespace,
    oauthClient,
    credentialStore,
    initialize: () => migrateLegacyAuthNamespace(namespace),
  });
}

function createHttpOAuthClient(
  endpoints: CreateMcodeSharedAuthSessionOptions['oauthEndpoints'],
): HttpOAuthClient {
  if (!endpoints) {
    throw new TypeError(
      'Shared Rig OAuth requires explicit device authorization, token, and revocation endpoints.',
    );
  }
  return new HttpOAuthClient(endpoints);
}
