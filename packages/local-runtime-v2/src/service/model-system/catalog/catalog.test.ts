import { describe, expect, it } from 'vitest';

import type { LocalRuntimeConfig } from '../contracts.js';
import { listLocalRuntimeModels, resolveLocalRuntimeModelKey } from './catalog.js';

function config(overrides: Partial<LocalRuntimeConfig> = {}): LocalRuntimeConfig {
  return {
    dataDir: '/tmp/model-catalog-test',
    provider: {},
    ...overrides,
  };
}

describe('listLocalRuntimeModels', () => {
  it('uses the configured default model and variant when no selection is supplied', () => {
    const entries = listLocalRuntimeModels(
      config({
        defaultModel: 'builtin/base',
        defaultModelVariant: 'thinking',
        provider: {
          builtin: {
            name: 'Builtin',
            api: 'openai-responses',
            options: { authMode: 'api-key' },
            models: {
              base: {
                thinking_config: { mode: 'switchable', default_value: 'false' },
                variants: { thinking: {}, 'none-thinking': {} },
              },
            },
          },
        },
      }),
    );

    expect(entries).toEqual([
      expect.objectContaining({
        providerId: 'builtin',
        providerName: 'Builtin',
        modelId: 'base',
        apiFormat: 'openai-responses',
        selected: true,
        variant: 'thinking',
      }),
    ]);
  });

  it('uses an explicit selection and attaches cached custom-provider status', () => {
    const entries = listLocalRuntimeModels(
      config({
        defaultModel: 'builtin/base',
        provider: {
          builtin: {
            options: { authMode: 'api-key' },
            models: { base: {} },
          },
        },
        custom_provider?: {
          work: {
            api: 'openai-completions',
            models: {
              historical: {},
              added: {
                reasoning: true,
                thinking_config: { mode: 'switchable', default_value: 'true' },
              },
            },
          },
        },
      }),
      { providerId: custom_provider?:work', modelId: 'added', variant: undefined },
      {
        cache: {
          version: 3,
          provider_status: {},
          model_status: {
            'builtin/base': {
              state: 'available',
              last_tested_at: 1_750_000_000_000,
            },
          },
        },
        implicitCustomProviderThinking: true,
      },
    );

    expect(entries).toEqual([
      expect.objectContaining({
        providerId: 'builtin',
        modelId: 'base',
        selected: false,
        status: { state: 'available', lastTestedAt: 1_750_000_000_000 },
      }),
      expect.objectContaining({
        providerId: custom_provider?:work',
        providerName: 'work',
        modelId: 'historical',
        apiFormat: 'openai-completions',
        selected: false,
        thinkingConfig: { mode: 'switchable', default_value: 'false' },
        variant: '',
      }),
      expect.objectContaining({
        providerId: custom_provider?:work',
        providerName: 'work',
        modelId: 'added',
        apiFormat: 'openai-completions',
        selected: true,
        thinkingConfig: { mode: 'switchable', default_value: 'true' },
        variant: 'thinking',
      }),
    ]);
  });

  it('reports the resolved managed Rig API protocol without model-name inference', () => {
    const entries = listLocalRuntimeModels(
      config({
        rigModelSource: 'rig_api_key',
        provider: { rig: { models: { 'Rig-M3': {} } } },
      }),
    );

    expect(entries).toContainEqual(
      expect.objectContaining({
        providerId: 'rig',
        modelId: 'Rig-M3',
        apiFormat: 'anthropic-messages',
      }),
    );
  });

  it.each(['model-without-provider', '/model', 'provider/'])(
    'ignores an incomplete default model key %#',
    (defaultModel) => {
      expect(listLocalRuntimeModels(config({ defaultModel }))).toEqual([]);
    },
  );
});

describe('resolveLocalRuntimeModelKey', () => {
  const modelConfig = config({
    provider: {
      rig: {
        name: 'Rig',
        options: { authMode: 'api-key' },
        models: {
          'Rig-M2.7': { name: 'Rig-M2.7' },
          'Rig-M2.7-highspeed': { name: 'Rig-M2.7-highspeed' },
          'Rig-M3': { name: 'Rig-M3' },
        },
      },
    },
  });

  it('keeps an exact source-qualified model key', () => {
    expect(resolveLocalRuntimeModelKey(modelConfig, 'rig/Rig-M3')).toEqual({
      kind: 'resolved',
      modelKey: 'rig/Rig-M3',
    });
  });

  it('normalizes a unique model shorthand to its source-qualified key', () => {
    expect(resolveLocalRuntimeModelKey(modelConfig, 'M3')).toEqual({
      kind: 'resolved',
      modelKey: 'rig/Rig-M3',
    });
  });

  it('returns every candidate instead of guessing when shorthand is ambiguous', () => {
    expect(resolveLocalRuntimeModelKey(modelConfig, '2.7')).toEqual({
      kind: 'ambiguous',
      candidates: ['rig/Rig-M2.7', 'rig/Rig-M2.7-highspeed'],
    });
  });

  it('reports a model name that does not exist in the current catalog', () => {
    expect(resolveLocalRuntimeModelKey(modelConfig, 'imaginary-model')).toEqual({
      kind: 'not_found',
    });
  });
});
