import type {
  AgentConfigDiagnostic,
  AgentConfigDocument,
  AgentConfiguredDefinition,
  AgentEffectiveConfigForNewSession,
} from '../../contracts.js';
import type { CanonicalAgentConfig } from '../../storage/canonical-agent-config.js';

/**
 * Pure projection shared by Config GET and successful Config PUT. The raw
 * document remains authoritative; this is deliberately not a second parser.
 */
export function toAgentConfigDocument(input: {
  readonly exactOwnerName: string;
  readonly ownerKind: 'builtin' | 'custom';
  readonly content: string;
  readonly revision: string;
  readonly config: CanonicalAgentConfig;
  readonly ownerInstanceId?: string;
  readonly baselineContent?: string;
  /** Resolved by the Runtime ModelSystem, never inferred from a raw string here. */
  readonly effectiveModel?: Pick<
    AgentEffectiveConfigForNewSession,
    'providerId' | 'modelId' | 'effort' | 'contextWindow' | 'maxOutputTokens'
  >;
}): AgentConfigDocument {
  const configured = toConfiguredDefinition(input.config);
  return {
    exactOwnerName: input.exactOwnerName,
    ...(input.ownerInstanceId ? { ownerInstanceId: input.ownerInstanceId } : {}),
    ownerKind: input.ownerKind,
    persistence: input.ownerKind === 'builtin' ? 'launch-scoped' : 'persistent',
    appliesTo: 'new-sessions-only',
    revision: input.revision,
    content: input.content,
    configured,
    effectiveForNewSession: toEffectiveConfig(input.config, input.effectiveModel),
    diagnostics: input.config.diagnostics.map(toDiagnostic),
    ...(input.baselineContent === undefined ? {} : { baselineContent: input.baselineContent }),
  };
}

/** Canonical model intent reused when a bundled profile has not materialized yet. */
export function toConfiguredModelSelection(config: CanonicalAgentConfig): Pick<
  AgentEffectiveConfigForNewSession,
  'effort' | 'contextWindow' | 'maxOutputTokens'
> & {
  readonly model?: string;
} {
  return {
    ...(config.model ? { model: config.model } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.xRig?.contextWindow === undefined
      ? {}
      : { contextWindow: config.xRig.contextWindow }),
    ...(config.xRig?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: config.xRig.maxOutputTokens }),
  };
}

/** Projects a parsed canonical config without reinterpreting its raw document. */
export function toConfiguredDefinition(config: CanonicalAgentConfig): AgentConfiguredDefinition {
  const rig = config.xRig;
  return {
    name: config.name,
    description: config.description,
    ...(config.model ? { model: config.model } : {}),
    ...(config.effort ? { effort: config.effort } : {}),
    ...(config.tools === undefined ? {} : { tools: [...config.tools] }),
    ...(config.disallowedTools === undefined
      ? {}
      : { disallowedTools: [...config.disallowedTools] }),
    ...(config.mcpServers === undefined ? {} : { mcpServers: [...config.mcpServers] }),
    ...(config.skills === undefined ? {} : { skills: [...config.skills] }),
    ...(rig === undefined ? {} : { rig: toConfiguredRig(rig) }),
    systemPrompt: config.systemPrompt,
  };
}

function toConfiguredRig(
  rig: NonNullable<CanonicalAgentConfig['xRig']>,
): NonNullable<AgentConfiguredDefinition['rig']> {
  return {
    ...(rig.displayName ? { displayName: rig.displayName } : {}),
    ...(rig.avatar ? { avatar: rig.avatar } : {}),
    ...(rig.contextWindow === undefined ? {} : { contextWindow: rig.contextWindow }),
    ...(rig.maxOutputTokens === undefined ? {} : { maxOutputTokens: rig.maxOutputTokens }),
    ...(rig.defaultWorkspaceDir ? { defaultWorkspaceDir: rig.defaultWorkspaceDir } : {}),
    ...(rig.extensionSkills === undefined ? {} : { extensionSkills: [...rig.extensionSkills] }),
  };
}

function toEffectiveConfig(
  config: CanonicalAgentConfig,
  effectiveModel:
    | Pick<
        AgentEffectiveConfigForNewSession,
        'providerId' | 'modelId' | 'effort' | 'contextWindow' | 'maxOutputTokens'
      >
    | undefined,
): AgentEffectiveConfigForNewSession {
  return {
    ...(effectiveModel?.providerId ? { providerId: effectiveModel.providerId } : {}),
    ...(effectiveModel?.modelId ? { modelId: effectiveModel.modelId } : {}),
    ...(effectiveModel?.effort ? { effort: effectiveModel.effort } : {}),
    ...(effectiveModel?.contextWindow === undefined
      ? {}
      : { contextWindow: effectiveModel.contextWindow }),
    ...(effectiveModel?.maxOutputTokens === undefined
      ? {}
      : { maxOutputTokens: effectiveModel.maxOutputTokens }),
    ...(config.tools === undefined ? {} : { tools: [...config.tools] }),
    ...(config.mcpServers === undefined ? {} : { mcpServers: [...config.mcpServers] }),
    ...(config.skills === undefined ? {} : { skills: [...config.skills] }),
    ...(config.xRig?.extensionSkills === undefined
      ? {}
      : { extensionSkills: [...config.xRig.extensionSkills] }),
  };
}

function toDiagnostic(input: CanonicalAgentConfig['diagnostics'][number]): AgentConfigDiagnostic {
  return { code: input.code, fieldPath: input.field };
}
