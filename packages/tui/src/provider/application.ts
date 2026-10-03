import type {
  RigCodexOAuthStartResult,
  RigCodexOAuthLoginOptions,
  RigCodexOAuthStatus,
  RigCreateProviderInput,
  RigDiscoverProviderModelsInput,
  RigModelSource,
  RigProviderRuntimePort,
  RigSaveProviderCandidateInput,
  RigSaveProviderCandidateResult,
  RigProviderSnapshot,
  RigProviderTestResult,
  RigProviderView,
  RigRuntimeProviderView,
  RigUpdateProviderInput,
} from './contract.js';
import { isModelProviderApiFormat } from './contract.js';

export class RigProviderApplication {
  constructor(private readonly port: RigProviderRuntimePort) {}

  async snapshot(
    options: { readonly includeCodexOAuth?: boolean } = {},
  ): Promise<RigProviderSnapshot> {
    const [customProviders, rigStatus, rigModelSource, codexOAuthStatus] =
      await Promise.all([
        this.port.listUserModelProviders(),
        this.port.getRigApiKeyStatus(),
        this.port.getRigModelSource(),
        options.includeCodexOAuth ? this.port.getCodexOAuthStatus() : undefined,
      ]);
    return {
      rigModelSource,
      providers: [
        ...(!codexOAuthStatus || codexOAuthStatus.state === 'hidden'
          ? []
          : [normalizeCodexOAuthProvider(codexOAuthStatus)]),
        {
          providerId: 'rig_oauth',
          name: 'Rig OAuth',
          kind: 'rig-oauth',
          active: rigModelSource === 'token_plan',
          enabled: true,
          readOnly: true,
          hasApiKey: false,
          models: [],
        },
        {
          providerId: 'rig_api',
          name: 'Rig API Key',
          kind: 'rig-api-key',
          active: rigModelSource === 'rig_api_key',
          enabled: true,
          readOnly: false,
          hasApiKey: rigStatus.hasApiKey,
          ...(rigStatus.maskedApiKey ? { maskedApiKey: rigStatus.maskedApiKey } : {}),
          ...(rigStatus.cachedStatus ? { status: rigStatus.cachedStatus } : {}),
          models: [],
        },
        ...customProviders.map(normalizeCustomProvider),
      ],
    };
  }

  setRigSource(source: RigModelSource): Promise<RigModelSource> {
    return this.port.setRigModelSource(source);
  }

  connectCodexOAuth(options?: RigCodexOAuthLoginOptions): Promise<RigCodexOAuthStartResult> {
    return this.port.startCodexOAuthLogin(options);
  }

  getCodexOAuthStatus(): Promise<RigCodexOAuthStatus> {
    return this.port.getCodexOAuthStatus();
  }

  cancelCodexOAuthLogin(loginId: string): Promise<RigCodexOAuthStatus> {
    return this.port.cancelCodexOAuthLogin(loginId);
  }

  async setRigApiKey(apiKey: string, saveAndUse = true): Promise<void> {
    await this.port.upsertRigApiKey({ apiKey, saveAndUse });
  }

  /** Step-5 roster login: validated api-key in, existing port writes out. */
  async loginProvider(input: {
    readonly providerId: string;
    readonly apiKey: string;
    readonly baseUrl?: string;
    readonly apiFormat?: 'anthropic-messages' | 'openai-completions' | 'openai-responses';
    readonly name?: string;
  }): Promise<void> {
    const providerId = input.providerId.trim();
    const apiKey = input.apiKey.trim();
    if (!providerId) throw new Error('Provider id is required.');
    if (!apiKey) throw new Error('API key is required.');
    if (providerId === 'rig' || providerId === 'rig_api') {
      await this.setRigApiKey(apiKey);
    } else {
      const existing = await this.port.listUserModelProviders();
      const match = existing.find(
        (provider) =>
          provider.providerId === `custom_provider:${providerId}` ||
          provider.providerId === providerId,
      );
      if (match) {
        await this.port.updateUserModelProvider({
          providerId: match.providerId,
          apiKey,
          saveAndUse: false,
        });
      } else {
        const templates = await this.port.listProviderPresets();
        const template = templates.find((candidate) => candidate.providerId === providerId);
        const baseUrl = template?.baseUrl ?? input.baseUrl;
        if (!baseUrl) {
          throw new Error(`No endpoint configured for provider '${providerId}'.`);
        }
        await this.port.createUserModelProvider({
          ...(template
            ? { name: template.name, baseUrl: template.baseUrl, apiFormat: template.apiFormat }
            : {
                ...(input.name ? { name: input.name } : {}),
                baseUrl,
                ...(input.apiFormat ? { apiFormat: input.apiFormat } : { apiFormat: 'openai-completions' as const }),
              }),
          apiKey,
          models: [],
          saveAndUse: false,
        });
      }
    }
  }

  async create(input: RigCreateProviderInput): Promise<void> {
    await this.port.createUserModelProvider(input);
  }

  saveCandidate(input: RigSaveProviderCandidateInput): Promise<RigSaveProviderCandidateResult> {
    return this.port.saveUserModelProviderCandidate(input);
  }

  discoverModels(input: RigDiscoverProviderModelsInput) {
    return this.port.discoverUserModelsCandidate(input);
  }

  async refreshModels(provider: RigProviderView): Promise<number> {
    if (
      provider.kind !== 'custom' ||
      provider.readOnly ||
      !provider.baseUrl ||
      !provider.configRevision
    ) {
      throw new Error('Reopen /provider and select an editable connection.');
    }
    const candidate = {
      providerId: provider.providerId,
      expectedRevision: provider.configRevision,
      baseUrl: provider.baseUrl,
    };
    const discovered = await this.port.discoverUserModelsCandidate(candidate);
    const ids = new Set(provider.models.map(({ modelId }) => modelId));
    const added = discovered
      .map(({ modelId, displayName }) => ({
        modelId: modelId.trim(),
        ...(displayName ? { displayName } : {}),
      }))
      .filter(({ modelId }) => {
        if (!modelId || ids.has(modelId)) return false;
        ids.add(modelId);
        return true;
      });
    const firstAdded = added[0];
    if (!firstAdded) return 0;
    const result = await this.port.saveUserModelProviderCandidate({
      ...candidate,
      // IDs retain every saved model field, including disabled state and limits.
      models: [
        ...provider.models.map(({ modelId }) => ({ modelId })),
        ...added.map((model) => ({ ...model, configurationSource: 'discovered' as const })),
      ],
      modelId: firstAdded.modelId,
      skipConnectionTest: true,
      saveAndUse: false,
    });
    if (!result.success)
      throw new Error(result.status?.lastErrorMessage ?? 'Could not save refreshed models.');
    return added.length;
  }

  async update(input: RigUpdateProviderInput): Promise<void> {
    await this.port.updateUserModelProvider(input);
  }

  async remove(providerId: string): Promise<void> {
    await this.port.deleteUserModelProvider(providerId);
  }

  test(providerId: string, modelId?: string): Promise<RigProviderTestResult> {
    return modelId
      ? this.port.testUserModel(providerId, modelId)
      : this.port.testUserModelProvider(providerId);
  }
}

function normalizeCodexOAuthProvider(status: RigCodexOAuthStatus): RigProviderView {
  return {
    providerId: status.providerId,
    name: 'OpenAI Codex',
    kind: 'codex-oauth',
    active: false,
    enabled: true,
    readOnly: true,
    hasApiKey: false,
    models: [],
    status: {
      state: status.state,
      ...(status.error ? { lastErrorMessage: status.error } : {}),
    },
  };
}

function normalizeCustomProvider(provider: RigRuntimeProviderView): RigProviderView {
  const apiFormat = isModelProviderApiFormat(provider.apiFormat) ? provider.apiFormat : undefined;
  return {
    providerId: provider.providerId,
    name: provider.name?.trim() || provider.providerId,
    kind: 'custom',
    // A disabled provider is never "in use": Runtime drops it from the model
    // roster (`enabledCustomProviders`) and BYOK resolution refuses it, so a
    // leftover `selected` model must not render as the active source.
    active: Boolean(
      provider.enabled !== false &&
      provider.models?.some((model) => 'selected' in model && model.selected),
    ),
    enabled: provider.enabled !== false,
    readOnly: provider.kind === 'oauth',
    ...(provider.configRevision ? { configRevision: provider.configRevision } : {}),
    ...(apiFormat ? { apiFormat } : {}),
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
    hasApiKey: Boolean(provider.hasApiKey),
    ...(provider.maskedApiKey ? { maskedApiKey: provider.maskedApiKey } : {}),
    models: (provider.models ?? []).map((model) => ({
      modelId: model.modelId,
      ...(model.displayName ? { displayName: model.displayName } : {}),
      ...(model.selected !== undefined ? { selected: model.selected } : {}),
      ...(model.contextLimit !== undefined ? { contextLimit: model.contextLimit } : {}),
      ...(model.maxOutputTokens !== undefined ? { maxOutputTokens: model.maxOutputTokens } : {}),
      ...(model.status ? { status: model.status } : {}),
    })),
    ...(provider.status ? { status: provider.status } : {}),
  };
}

export type {
  RigCreateProviderInput,
  RigDiscoverProviderModelsInput,
  RigProviderRuntimePort,
  RigProviderSnapshot,
  RigUpdateProviderInput,
} from './contract.js';
