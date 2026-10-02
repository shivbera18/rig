import { maskSecret } from '../secret.js';
import { MANAGED_RIG_PROVIDER_ID, RIG_API_PROVIDER_ID } from '../identity.js';
import type { LocalModelConfig, ModelContextUpdateOutcome } from '../contracts.js';
import {
  cacheStatusView,
  rigApiModels,
  type ModelCacheStatusView,
} from '../catalog/list-models.js';
import { modelCacheStatusFor, type ModelCacheStatusEntry } from '../catalog/model-cache.js';
import { buildRigProviderView, type ModelProviderView } from '../catalog/provider-views.js';
import { ModelProviderServiceContext } from './service-context.js';
import { LocalModelProviderError } from '../contracts.js';
import {
  asLocalModelProviderError,
  contextChangedError,
  enqueueProviderMutation,
  rigContextBaselineFingerprint,
  requireCacheStatusView,
} from './service-helpers.js';
import { assertValidRawApiKey } from './service-input.js';

interface RigContextUpdateInput {
  modelId: string;
  contextLimit: number;
  expectedContextLimit: number;
}

interface PreparedRigContextUpdate {
  modelId: string;
  currentModel: LocalModelConfig;
  baselineFingerprint: string;
  source: 'token_plan' | 'rig_api_key';
  compareAndSet: NonNullable<ModelProviderServiceContext['deps']['compareAndSetModelContext']>;
}

export function getRigApiKeyStatus(context: ModelProviderServiceContext): {
  hasApiKey: boolean;
  maskedApiKey?: string;
  cachedStatus?: ModelCacheStatusView;
} {
  const apiKey = context.deps.configGetter().rig_api?.apiKey?.trim();
  if (!apiKey) return { hasApiKey: false };
  const cache = context.deps.cache.load();
  const target = context.resolveTestTarget(RIG_API_PROVIDER_ID, undefined);
  return {
    hasApiKey: true,
    maskedApiKey: maskSecret(apiKey),
    cachedStatus: cacheStatusView(
      modelCacheStatusFor(
        cache,
        RIG_API_PROVIDER_ID,
        target.target.modelId,
        target.fingerprint,
      ),
    ),
  };
}

export function getRigModelSource(
  context: ModelProviderServiceContext,
): 'token_plan' | 'rig_api_key' {
  return context.deps.configGetter().rigModelSource ?? 'token_plan';
}

export async function setRigModelSource(
  context: ModelProviderServiceContext,
  source: 'token_plan' | 'rig_api_key',
): Promise<string> {
  if (source !== 'token_plan' && source !== 'rig_api_key') {
    throw new LocalModelProviderError(400, 'Invalid Rig model source', 'VALIDATION_ERROR');
  }
  let blocked: LocalModelProviderError | undefined;
  await context.deps.updateByokConfig((draft, currentConfig) => {
    if (source === 'rig_api_key') {
      try {
        context.resolveRigTestTarget(currentConfig, undefined);
      } catch (error) {
        blocked = asLocalModelProviderError(error);
        return;
      }
    }
    draft.rigModelSource = source;
  });
  if (blocked) throw blocked;
  return source;
}

export async function updateRigModelContext(
  context: ModelProviderServiceContext,
  input: RigContextUpdateInput,
): Promise<ModelContextUpdateOutcome> {
  return enqueueProviderMutation(context.rigMutationKey(), () =>
    updateRigModelContextTransaction(context, input),
  );
}

async function updateRigModelContextTransaction(
  context: ModelProviderServiceContext,
  input: RigContextUpdateInput,
): Promise<ModelContextUpdateOutcome> {
  const prepared = prepareRigContextUpdate(context, input);
  if (prepared.source === 'token_plan') {
    return updateTokenPlanModelContext(prepared, input);
  }
  return updateRigApiModelContext(context, prepared, input);
}

function prepareRigContextUpdate(
  context: ModelProviderServiceContext,
  input: RigContextUpdateInput,
): PreparedRigContextUpdate {
  const modelId = requireRigContextSelection(input);
  const compareAndSet = context.deps.compareAndSetModelContext;
  if (!compareAndSet) {
    throw new LocalModelProviderError(
      503,
      'Model context selection is unavailable',
      'MODEL_CONTEXT_UNAVAILABLE',
    );
  }
  const baselineConfig = context.deps.configGetter();
  const source = baselineConfig.rigModelSource ?? 'token_plan';
  const currentModel =
    source === 'token_plan'
      ? baselineConfig.provider?.rig?.models?.[modelId]
      : rigApiModels(baselineConfig)[modelId];
  if (!currentModel) {
    throw new LocalModelProviderError(404, 'Model not found', 'MODEL_NOT_FOUND');
  }
  if (!currentModel.contextWindowOptions?.includes(input.contextLimit)) {
    throw new LocalModelProviderError(
      400,
      'Invalid Rig model context selection',
      'INVALID_CONTEXT_LIMIT',
    );
  }
  if ((currentModel.limit?.context ?? 0) !== input.expectedContextLimit) {
    throw new LocalModelProviderError(
      409,
      'Model context changed before the update started',
      'CONFIG_CHANGED',
    );
  }

  const baselineFingerprint = rigContextBaselineFingerprint(baselineConfig, modelId);
  return { modelId, currentModel, baselineFingerprint, source, compareAndSet };
}

function requireRigContextSelection(input: RigContextUpdateInput): string {
  const modelId = input.modelId?.trim();
  if (!modelId || !Number.isSafeInteger(input.contextLimit) || input.contextLimit <= 0) {
    throw new LocalModelProviderError(
      400,
      'Invalid Rig model context selection',
      'INVALID_CONTEXT_LIMIT',
    );
  }
  if (!Number.isSafeInteger(input.expectedContextLimit) || input.expectedContextLimit <= 0) {
    throw new LocalModelProviderError(
      400,
      'expected_context_limit must be a positive integer',
      'VALIDATION_ERROR',
    );
  }
  return modelId;
}

async function updateTokenPlanModelContext(
  prepared: PreparedRigContextUpdate,
  input: RigContextUpdateInput,
): Promise<ModelContextUpdateOutcome> {
  const updated = await prepared.compareAndSet(
    rigContextUpdateSelection(prepared.source, prepared.modelId, input),
    async (latestConfig) =>
      rigContextBaselineFingerprint(latestConfig, prepared.modelId) ===
      prepared.baselineFingerprint,
  );
  if (!updated) throw contextChangedError();
  return { ok: true };
}

async function updateRigApiModelContext(
  context: ModelProviderServiceContext,
  prepared: PreparedRigContextUpdate,
  input: RigContextUpdateInput,
): Promise<ModelContextUpdateOutcome> {
  const candidateModel: LocalModelConfig = {
    ...prepared.currentModel,
    limit: { ...prepared.currentModel.limit, context: input.contextLimit },
  };
  const target = context.resolveTestTarget(RIG_API_PROVIDER_ID, prepared.modelId, {
    rigModelOverride: candidateModel,
  });
  const result = await context.deps.tester.test(
    `${target.cacheKey}@${target.fingerprint}`,
    target.target,
  );
  const entry = context.toCacheEntry(result, target.fingerprint);
  const status = requireCacheStatusView(entry);
  if (!result.ok) return { ok: false, status };

  let previousCacheEntry: ModelCacheStatusEntry | undefined;
  let candidateCacheWritten = false;
  try {
    const updated = await prepared.compareAndSet(
      rigContextUpdateSelection(prepared.source, prepared.modelId, input),
      async (latestConfig) => {
        const latestFingerprint = rigContextBaselineFingerprint(latestConfig, prepared.modelId);
        if (latestFingerprint !== prepared.baselineFingerprint) return false;
        previousCacheEntry = await context.deps.cache.replaceModelStatus(target.cacheKey, entry);
        candidateCacheWritten = true;
        return true;
      },
    );
    if (!updated) throw contextChangedError();
  } catch (error) {
    if (candidateCacheWritten) {
      try {
        await context.deps.cache.restoreModelStatusIfCurrent(
          target.cacheKey,
          entry,
          previousCacheEntry,
        );
      } catch {
        throw new LocalModelProviderError(
          500,
          'Failed to restore model test status after the config write failed',
          'CACHE_ROLLBACK_FAILED',
        );
      }
    }
    throw error;
  }
  return { ok: true, status };
}

function rigContextUpdateSelection(
  source: PreparedRigContextUpdate['source'],
  modelId: string,
  input: RigContextUpdateInput,
): {
  providerId: string;
  modelId: string;
  expectedContextLimit: number;
  contextLimit: number;
} {
  return {
    providerId: source === 'token_plan' ? MANAGED_RIG_PROVIDER_ID : RIG_API_PROVIDER_ID,
    modelId,
    expectedContextLimit: input.expectedContextLimit,
    contextLimit: input.contextLimit,
  };
}

export async function upsertRigApiKey(
  context: ModelProviderServiceContext,
  input: { apiKey: string; saveAndUse?: boolean },
): Promise<ModelProviderView> {
  const apiKey = assertValidRawApiKey(input.apiKey);
  await context.deps.updateByokConfig((draft) => {
    draft.rig_api = { ...(draft.rig_api ?? {}), apiKey };
    if (input.saveAndUse) draft.rigModelSource = 'rig_api_key';
  });
  return buildRigProviderView(context.deps.configGetter(), context.deps.cache.load());
}
