import type { AuthLeaseStatus } from '@rig/oauth-lease-protocol';

export interface RigToolsAccessTokenLease {
  accessToken: string;
  expiresAtMs: number;
  generation: number;
  scopes: readonly ['agent.default'];
  audience: 'agent-backend';
}

export interface RigToolsAuthStatusSnapshot {
  status: AuthLeaseStatus;
  generation: number;
  expiresAtMs?: number;
}

export interface RigToolsHostAuthSession {
  getStatus(): Promise<RigToolsAuthStatusSnapshot>;
  getAccessToken(minValidityMs: number): Promise<RigToolsAccessTokenLease>;
  handleUnauthorized(generation: number): Promise<'retry' | 'logout'>;
  watch(listener: (status: RigToolsAuthStatusSnapshot) => void): () => void;
}

export interface RigToolsHostLogger {
  info(message: string): void;
  warn(message: string): void;
}
