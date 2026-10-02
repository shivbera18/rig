import type { AuthNamespaceInput } from './contracts.js';
import { RigOAuthCore } from './auth-core.js';
import { createCredentialStore } from './credential-store/factory.js';
import { createAuthNamespace } from './namespace.js';
import { migrateLegacyAuthNamespace } from './namespace-migration.js';
import { HttpOAuthClient, type HttpOAuthClientOptions } from './oauth-client.js';
import {
  createAuthManager,
  createTokenProvider,
  type RigAuthManager,
  type RigTokenProvider,
} from './token-provider.js';

export interface CreateRigLocalAuthOptions extends AuthNamespaceInput {
  fetchImpl?: typeof fetch;
  endpoints: Pick<
    HttpOAuthClientOptions,
    | 'deviceAuthorizationEndpoint'
    | 'deviceAuthorizationHeaders'
    | 'tokenEndpoint'
    | 'revocationEndpoint'
  >;
}

export function createRigTokenProvider(options: CreateRigLocalAuthOptions): RigTokenProvider {
  return createTokenProvider(createCore(options));
}

export function createRigAuthManager(options: CreateRigLocalAuthOptions): RigAuthManager {
  return createAuthManager(createCore(options));
}

function createCore(options: CreateRigLocalAuthOptions): RigOAuthCore {
  const namespace = createAuthNamespace(options);
  return new RigOAuthCore({
    namespace,
    credentialStore: createCredentialStore({ authHome: namespace.namespaceHome }),
    oauthClient: new HttpOAuthClient({ ...options.endpoints, fetchImpl: options.fetchImpl }),
    initialize: () => migrateLegacyAuthNamespace(namespace),
  });
}
