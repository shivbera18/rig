import { randomUUID } from 'node:crypto';

import * as acp from '@agentclientprotocol/sdk';

import type { TuiSession } from '../runtime/port.js';
import type { TuiAcpRuntime } from './runtime.js';

export const TUI_ACP_EXTENSION_VERSION = 1;

const TUI_ACP_GOAL_METHODS = [
  'rig/session/goal/get',
  'rig/session/goal/create',
  'rig/session/goal/patch',
  'rig/session/goal/clear',
] as const;

export const TUI_ACP_EXTENSION_METHODS = [
  'session/activate',
  'rig/session/activate',
  'rig/session/steer',
  'rig/session/queue/list',
  'rig/session/queue/enqueue',
  'rig/session/queue/update',
  'rig/session/queue/delete',
  'rig/session/queue/steer',
  ...TUI_ACP_GOAL_METHODS,
  'rig/session/delegation/get',
  'rig/session/delegation/stop',
] as const;

export const TUI_ACP_EXTENSION_NOTIFICATIONS = [
  'rig/session/current_session_update',
  'rig/session/queue_update',
  'rig/session/goal_update',
  'rig/session/delegation_update',
] as const;

export function tuiAcpExtensionCapabilities(runtime: Pick<TuiAcpRuntime, 'isGoalEnabled'>): {
  readonly methods: readonly string[];
  readonly notifications: readonly string[];
} {
  const goalEnabled = runtime.isGoalEnabled();
  return {
    methods: goalEnabled
      ? TUI_ACP_EXTENSION_METHODS
      : TUI_ACP_EXTENSION_METHODS.filter(
          (method) => !TUI_ACP_GOAL_METHODS.some((goalMethod) => goalMethod === method),
        ),
    notifications: goalEnabled
      ? TUI_ACP_EXTENSION_NOTIFICATIONS
      : TUI_ACP_EXTENSION_NOTIFICATIONS.filter(
          (notification) => notification !== 'rig/session/goal_update',
        ),
  };
}

export interface RegisterTuiAcpExtensionsOptions {
  readonly app: acp.AgentApp;
  readonly runtime: TuiAcpRuntime;
  readonly resolveSession: (sessionId: string) => TuiSession | undefined;
  readonly activateSession: (sessionId: string) => void;
  readonly extensionNotificationsEnabled: () => boolean;
  readonly activePromptTurnId: (sessionId: string) => string | undefined;
  readonly createRequestId?: () => string;
}

export function registerTuiAcpExtensions(options: RegisterTuiAcpExtensionsOptions): void {
  const createRequestId = options.createRequestId ?? randomUUID;
  const resolve = (sessionId: string) => requireSession(options.resolveSession, sessionId);
  const requireGoalEnabled = () => {
    if (!options.runtime.isGoalEnabled()) {
      throw acp.RequestError.invalidParams(
        undefined,
        'Goal extensions are disabled by the Runtime feature configuration.',
      );
    }
  };
  const activateSession = async (sessionId: string, client: acp.AgentContext) => {
    resolve(sessionId);
    options.activateSession(sessionId);
    if (options.extensionNotificationsEnabled()) {
      await client
        .notify('rig/session/current_session_update', { sessionId })
        .catch(() => undefined);
    }
    return { sessionId };
  };

  options.app.onRequest('session/activate', parseSessionRequest, ({ params, client }) =>
    activateSession(params.sessionId, client),
  );
  options.app.onRequest('rig/session/activate', parseSessionRequest, ({ params, client }) =>
    activateSession(params.sessionId, client),
  );

  options.app.onRequest('rig/session/steer', parseTextRequest, async ({ params }) => {
    resolve(params.sessionId);
    const expectedTurnId = options.activePromptTurnId(params.sessionId);
    if (!expectedTurnId) {
      throw acp.RequestError.invalidParams(
        undefined,
        'Steering requires an admitted, active ACP prompt Turn for this Session.',
      );
    }
    const result = await options.runtime.steer({
      sessionId: params.sessionId,
      source: 'api',
      message: { content: params.text },
      producerId: 'rig-acp',
      idempotencyKey: params.clientRequestId ?? createRequestId(),
      preDelivery: {
        accept: ({ mode, turnId }) => {
          if (
            mode !== 'steered' ||
            turnId !== expectedTurnId ||
            options.activePromptTurnId(params.sessionId) !== expectedTurnId
          ) {
            throw acp.RequestError.invalidParams(
              undefined,
              'The active ACP prompt Turn changed before steering was admitted.',
            );
          }
        },
      },
    });
    if (result.mode === 'activated') {
      void result.completion.catch(() => undefined);
      throw acp.RequestError.invalidParams(
        undefined,
        'Steering cannot activate a new Turn for an ACP prompt.',
      );
    }
    if (result.turnId !== expectedTurnId) {
      throw acp.RequestError.invalidParams(
        undefined,
        'The steer result did not match the active ACP prompt Turn.',
      );
    }
    return { turnId: result.turnId, mode: result.mode };
  });

  options.app.onRequest('rig/session/queue/list', parseSessionRequest, async ({ params }) => {
    resolve(params.sessionId);
    return { items: await options.runtime.listQueuedMessages(params.sessionId) };
  });

  options.app.onRequest('rig/session/queue/enqueue', parseTextRequest, async ({ params }) => {
    resolve(params.sessionId);
    return options.runtime.enqueueMessage(params.sessionId, params.text);
  });

  options.app.onRequest('rig/session/queue/update', parseQueueTextRequest, async ({ params }) => {
    resolve(params.sessionId);
    return {
      item:
        (await options.runtime.updateQueuedMessageContent(
          params.sessionId,
          params.itemId,
          params.text,
        )) ?? null,
    };
  });

  options.app.onRequest('rig/session/queue/delete', parseQueueItemRequest, async ({ params }) => {
    resolve(params.sessionId);
    return {
      item: (await options.runtime.deleteQueuedMessage(params.sessionId, params.itemId)) ?? null,
    };
  });

  options.app.onRequest('rig/session/queue/steer', parseQueueItemRequest, async ({ params }) => {
    resolve(params.sessionId);
    return options.runtime.steerQueuedMessage(params.sessionId, params.itemId);
  });

  options.app.onRequest('rig/session/goal/get', parseSessionRequest, async ({ params }) => {
    requireGoalEnabled();
    resolve(params.sessionId);
    return { goal: (await options.runtime.getGoal(params.sessionId)) ?? null };
  });

  options.app.onRequest('rig/session/goal/create', parseGoalCreateRequest, async ({ params }) => {
    requireGoalEnabled();
    resolve(params.sessionId);
    return {
      goal: await options.runtime.createGoal({
        sessionId: params.sessionId,
        objective: params.objective,
        ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
      }),
    };
  });

  options.app.onRequest('rig/session/goal/patch', parseGoalPatchRequest, async ({ params }) => {
    requireGoalEnabled();
    resolve(params.sessionId);
    return {
      goal: await options.runtime.patchGoal(params.sessionId, {
        ...(params.status !== undefined ? { status: params.status } : {}),
        ...(params.objective !== undefined ? { objective: params.objective } : {}),
        ...(params.tokenBudget !== undefined ? { tokenBudget: params.tokenBudget } : {}),
      }),
    };
  });

  options.app.onRequest('rig/session/goal/clear', parseSessionRequest, async ({ params }) => {
    requireGoalEnabled();
    resolve(params.sessionId);
    return { cleared: await options.runtime.clearGoal(params.sessionId) };
  });

  options.app.onRequest('rig/session/delegation/get', parseSessionRequest, async ({ params }) => {
    const session = resolve(params.sessionId);
    const rootSessionId = await resolveRootSessionId(options.runtime, session);
    return { snapshot: await options.runtime.getDelegationSnapshot(rootSessionId) };
  });

  options.app.onRequest(
    'rig/session/delegation/stop',
    parseSessionRequest,
    async ({ params }) => {
      const session = resolve(params.sessionId);
      const rootSessionId = await resolveRootSessionId(options.runtime, session);
      return { receipt: await options.runtime.stopDelegation(rootSessionId) };
    },
  );
}

export function supportsTuiAcpExtensionNotifications(
  capabilities: acp.ClientCapabilities,
): boolean {
  const extension = capabilities._meta?.['rig/extensions'];
  return (
    extension === true ||
    (isRecord(extension) &&
      extension.version === TUI_ACP_EXTENSION_VERSION &&
      extension.notifications === true)
  );
}

export async function resolveRootSessionId(
  runtime: Pick<TuiAcpRuntime, 'getSession'>,
  session: TuiSession,
): Promise<string> {
  let current = session;
  const visited = new Set<string>();
  while (current.parentSessionId) {
    if (visited.has(current.sessionId)) {
      throw acp.RequestError.internalError(undefined, 'Session parent chain contains a cycle.');
    }
    visited.add(current.sessionId);
    current = await runtime.getSession(current.parentSessionId);
  }
  return current.sessionId;
}

function requireSession(
  resolveSession: (sessionId: string) => TuiSession | undefined,
  sessionId: string,
): TuiSession {
  const session = resolveSession(sessionId);
  if (!session) throw acp.RequestError.resourceNotFound(sessionId);
  return session;
}

function parseSessionRequest(value: unknown): { sessionId: string } {
  const record = requireRecord(value);
  return { sessionId: requireText(record.sessionId, 'sessionId') };
}

function parseTextRequest(value: unknown): {
  sessionId: string;
  text: string;
  clientRequestId?: string;
} {
  const record = requireRecord(value);
  const text = requireMessageText(record.text, 'text');
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    text,
    ...(record.clientRequestId === undefined
      ? {}
      : { clientRequestId: requireText(record.clientRequestId, 'clientRequestId') }),
  };
}

function parseQueueItemRequest(value: unknown): { sessionId: string; itemId: string } {
  const record = requireRecord(value);
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    itemId: requireText(record.itemId, 'itemId'),
  };
}

function parseQueueTextRequest(value: unknown): {
  sessionId: string;
  itemId: string;
  text: string;
} {
  return {
    ...parseQueueItemRequest(value),
    text: requireMessageText(requireRecord(value).text, 'text'),
  };
}

function parseGoalCreateRequest(value: unknown): {
  sessionId: string;
  objective: string;
  tokenBudget?: number | null;
} {
  const record = requireRecord(value);
  return {
    sessionId: requireText(record.sessionId, 'sessionId'),
    objective: requireText(record.objective, 'objective'),
    ...(record.tokenBudget === undefined
      ? {}
      : { tokenBudget: optionalBudget(record.tokenBudget, 'tokenBudget') }),
  };
}

const GOAL_STATUSES = ['active', 'paused', 'blocked', 'complete', 'budget_limited'] as const;
type GoalStatus = (typeof GOAL_STATUSES)[number];

function parseGoalPatchRequest(value: unknown): {
  sessionId: string;
  status?: GoalStatus;
  objective?: string;
  tokenBudget?: number | null;
} {
  const record = requireRecord(value);
  const status = record.status;
  if (status !== undefined && !GOAL_STATUSES.some((candidate) => candidate === status)) {
    throw acp.RequestError.invalidParams(undefined, 'status is not a supported Goal status.');
  }
  const patch = {
    ...(status === undefined ? {} : { status: status as GoalStatus }),
    ...(record.objective === undefined
      ? {}
      : { objective: requireText(record.objective, 'objective') }),
    ...(record.tokenBudget === undefined
      ? {}
      : { tokenBudget: optionalBudget(record.tokenBudget, 'tokenBudget') }),
  };
  if (Object.keys(patch).length === 0) {
    throw acp.RequestError.invalidParams(undefined, 'Goal patch must change at least one field.');
  }
  return { sessionId: requireText(record.sessionId, 'sessionId'), ...patch };
}

function optionalBudget(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be null or a positive number.`);
  }
  return value;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be a non-empty string.`);
  }
  return value.trim();
}

function requireMessageText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw acp.RequestError.invalidParams(undefined, `${label} must be a non-empty string.`);
  }
  return value;
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw acp.RequestError.invalidParams(undefined, 'Extension params must be an object.');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
