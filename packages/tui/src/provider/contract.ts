import type { ModelConfig } from '@rig/config';

export const RIG_PROVIDER_API_FORMATS = [
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
] as const;
export type RigProviderApiFormat = (typeof RIG_PROVIDER_API_FORMATS)[number];

const RIG_PROVIDER_API_FORMAT_SET = new Set<string>(RIG_PROVIDER_API_FORMATS);

export function isModelProviderApiFormat(value: unknown): value is RigProviderApiFormat {
  return typeof value === 'string' && RIG_PROVIDER_API_FORMAT_SET.has(value);
}
export type RigModelSource = 'token_plan' | 'rig_api_key';
export type RigProviderKind = 'codex-oauth' | 'rig-oauth' | 'rig-api-key' | 'custom';

export interface RigProviderStatus {
  readonly state: string;
  readonly lastTestedAt?: number;
  readonly lastErrorCode?: string;
  readonly lastErrorMessage?: string;
}

export interface RigProviderModel {
  readonly modelId: string;
  readonly displayName?: string;
  readonly selected?: boolean;
  readonly contextLimit?: number;
  readonly maxOutputTokens?: number;
  readonly status?: RigProviderStatus;
}

export interface RigRuntimeProviderView {
  readonly providerId: string;
  readonly name?: string;
  readonly kind?: string;
  readonly enabled?: boolean;
  readonly apiFormat?: string;
  readonly baseUrl?: string;
  readonly hasApiKey?: boolean;
  readonly maskedApiKey?: string;
  readonly rawApiKey?: string;
  readonly configRevision?: string;
  readonly models?: readonly RigProviderModel[];
  readonly status?: RigProviderStatus;
}

export interface RigProviderView {
  readonly providerId: string;
  readonly name: string;
  readonly kind: RigProviderKind;
  readonly active: boolean;
  readonly enabled: boolean;
  readonly readOnly: boolean;
  readonly configRevision?: string;
  readonly apiFormat?: RigProviderApiFormat;
  readonly baseUrl?: string;
  readonly hasApiKey: boolean;
  readonly maskedApiKey?: string;
  readonly models: readonly RigProviderModel[];
  readonly status?: RigProviderStatus;
}

export interface RigProviderSnapshot {
  readonly rigModelSource: RigModelSource;
  readonly providers: readonly RigProviderView[];
}

export interface RigProviderModelInput {
  readonly modelId: string;
  readonly displayName?: string;
  readonly configurationSource?: 'manual' | 'discovered';
  readonly enabled?: boolean;
  readonly attachment?: boolean;
  readonly reasoning?: boolean;
  readonly toolCall?: boolean;
  readonly temperature?: boolean;
  readonly capabilities?: Readonly<NonNullable<ModelConfig['capabilities']>>;
  readonly modalities?: { readonly input?: readonly string[]; readonly output?: readonly string[] };
  readonly limit?: { readonly context?: number; readonly output?: number };
}

export interface RigProviderTemplate {
  readonly providerId: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiFormat: RigProviderApiFormat;
  readonly models: readonly RigProviderModelInput[];
}

export type RigCodexOAuthState = 'hidden' | 'disconnected' | 'pending' | 'connected' | 'failed';

export type RigCodexOAuthLoginMethod = 'browser' | 'device_code';
export interface RigCodexOAuthLoginOptions {
  readonly method?: RigCodexOAuthLoginMethod;
}
export interface RigCodexOAuthStatus {
  readonly state: RigCodexOAuthState;
  readonly providerId: 'openai-codex';
  readonly error?: string;
  readonly loginId?: string;
  readonly method?: RigCodexOAuthLoginMethod;
  readonly authUrl?: string;
  readonly deviceCode?: {
    readonly userCode: string;
    readonly verificationUri: string;
    readonly expiresAt: number;
  };
}

export interface RigCodexOAuthStartResult extends RigCodexOAuthStatus {
  readonly authUrl?: string;
}

export interface RigCreateProviderInput {
  readonly name?: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly apiFormat: RigProviderApiFormat;
  readonly models: readonly RigProviderModelInput[];
  readonly saveAndUse?: boolean;
}

export interface RigUpdateProviderInput {
  readonly providerId: string;
  readonly name?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly apiFormat?: RigProviderApiFormat;
  readonly enabled?: boolean;
  readonly models?: readonly RigProviderModelInput[];
  readonly saveAndUse?: boolean;
}

export interface RigSaveProviderCandidateInput extends Omit<
  RigCreateProviderInput,
  'apiKey' | 'apiFormat' | 'models'
> {
  readonly providerId?: string;
  readonly expectedRevision?: string;
  readonly apiKey?: string;
  readonly apiFormat?: RigProviderApiFormat;
  readonly models?: readonly RigProviderModelInput[];
  readonly modelId: string;
  readonly skipConnectionTest?: boolean;
}

export type RigDiscoverProviderModelsInput = {
  readonly baseUrl: string;
} & (
  | { readonly providerId: string; readonly expectedRevision: string }
  | { readonly name: string; readonly apiKey: string; readonly apiFormat: RigProviderApiFormat }
);

export interface RigSaveProviderCandidateResult {
  readonly success: boolean;
  readonly status?: RigProviderStatus;
  readonly provider?: RigRuntimeProviderView;
}

export interface RigProviderTestResult {
  readonly success: boolean;
  readonly status: RigProviderStatus;
}

export interface RigProviderRuntimePort {
  discoverUserModelsCandidate(
    input: RigDiscoverProviderModelsInput,
  ): Promise<readonly RigProviderModel[]>;
  listProviderPresets(): Promise<readonly RigProviderTemplate[]>;
  getCodexOAuthStatus(): Promise<RigCodexOAuthStatus>;
  startCodexOAuthLogin(options?: RigCodexOAuthLoginOptions): Promise<RigCodexOAuthStartResult>;
  cancelCodexOAuthLogin(loginId: string): Promise<RigCodexOAuthStatus>;
  listUserModelProviders(): Promise<readonly RigRuntimeProviderView[]>;
  getRigApiKeyStatus(): Promise<{
    readonly hasApiKey: boolean;
    readonly maskedApiKey?: string;
    readonly rawApiKey?: string;
    readonly cachedStatus?: RigProviderStatus;
  }>;
  getRigModelSource(): Promise<RigModelSource>;
  setRigModelSource(source: RigModelSource): Promise<RigModelSource>;
  upsertRigApiKey(input: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }): Promise<void>;
  createUserModelProvider(input: RigCreateProviderInput): Promise<void>;
  saveUserModelProviderCandidate(
    input: RigSaveProviderCandidateInput,
  ): Promise<RigSaveProviderCandidateResult>;
  updateUserModelProvider(input: RigUpdateProviderInput): Promise<void>;
  deleteUserModelProvider(providerId: string): Promise<void>;
  testUserModelProvider(providerId: string): Promise<RigProviderTestResult>;
  testUserModel(providerId: string, modelId: string): Promise<RigProviderTestResult>;
  syncOAuthProviderModels(input: {
    readonly providerId: string;
    readonly access: string;
  }): Promise<{ refreshError?: string }>;
}
