import { randomUUID } from 'node:crypto';
import type { RigBuildEnv, RigRegion } from '@rig/config';

export type RigChatType = 'chat' | 'agent_team' | 'claw' | 'hermes' | 'IM';
export type RigLoginSource =
  | 'agent_web'
  | 'agent_desktop'
  | 'openplatform'
  | 'rig_tui'
  | 'rig_cli';
export type RigLoginFailReason = '' | '1' | '2' | '3' | '4' | '5';
export type RigSlashCommandType =
  | 'skill'
  | 'new_chat'
  | 'summarize'
  | 'plan_mode'
  | 'goal_mode'
  | 'other';
export type RigAtCommandType = 'plugins' | 'goal_mode' | 'plan_mode' | 'file' | 'directory';
export type RigDurationBucket =
  'not_applicable' | 'under_1m' | '1m_to_5m' | '5m_to_30m' | 'over_30m';

interface ChatContextProperties {
  readonly chat_type: RigChatType;
}

export interface RigBusinessEventMap {
  readonly tui_launch: { readonly launch_type: 'cold' | 'hot' };
  readonly login_click: Record<string, never>;
  readonly logout_click: Record<string, never>;
  readonly login_result: {
    readonly source: RigLoginSource;
    readonly result_type: '1' | '2';
    readonly fail_reason: RigLoginFailReason;
    readonly login_type: 'google' | 'mobile' | 'wechat' | 'apple' | 'rig_sso' | 'rig_oauth';
  };
  readonly btw_session_lifecycle: {
    readonly phase: 'opened' | 'closed';
    readonly duration_bucket: RigDurationBucket;
    readonly exit_reason: '' | 'ctrl_c' | 'ctrl_d' | 'navigation' | 'replaced';
  };
  readonly chat_send: ChatContextProperties & {
    readonly is_first_message: 0 | 1;
    readonly is_attachment: 'text' | 'attachment';
  };
  readonly slash_command_menu_view: ChatContextProperties;
  readonly slash_command_click: ChatContextProperties & {
    readonly command_type: RigSlashCommandType;
  };
  readonly at_command_menu_view: ChatContextProperties;
  readonly at_command_click: ChatContextProperties & {
    readonly command_type: RigAtCommandType;
  };
}

export type RigBusinessEventName = keyof RigBusinessEventMap;
export type RigBusinessEvent = {
  [Event in RigBusinessEventName]: {
    readonly event: Event;
    readonly properties: RigBusinessEventMap[Event];
  };
}[RigBusinessEventName];

export interface RigBusinessTelemetry {
  track<Event extends RigBusinessEventName>(
    event: Event,
    properties: RigBusinessEventMap[Event],
  ): void;
  flush(): Promise<void>;
}

export interface CreateRigBusinessTelemetryOptions {
  readonly region: RigRegion;
  readonly buildEnv: RigBuildEnv;
  readonly version: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly randomId?: () => string;
  readonly queueLimit?: number;
  readonly timeoutMs?: number;
}

export interface RigTelemetryPolicy {
  readonly enabled: boolean;
  readonly configured: boolean;
  readonly blockedBy?: 'RIG_DISABLE_TELEMETRY' | 'DO_NOT_TRACK';
}

export interface RigBusinessTelemetryPreview {
  readonly endpoint: string;
  readonly method: 'POST';
  readonly contentType: 'application/x-www-form-urlencoded';
  readonly payload: SensorsPayload;
}

export interface SensorsPayload {
  readonly identities: { readonly $identity_cookie_id: string };
  readonly distinct_id: string;
  readonly lib: {
    readonly $lib: 'js';
    readonly $lib_method: 'code';
    readonly $lib_version: string;
  };
  readonly properties: Record<string, unknown>;
  readonly type: 'track';
  readonly event: RigBusinessEventName;
  readonly time: number;
}

const DEFAULT_QUEUE_LIMIT = 100;
const EVENT_PROPERTY_KEYS = {
  tui_launch: ['launch_type'],
  login_click: [],
  logout_click: [],
  login_result: ['source', 'result_type', 'fail_reason', 'login_type'],
  btw_session_lifecycle: ['phase', 'duration_bucket', 'exit_reason'],
  chat_send: ['chat_type', 'is_first_message', 'is_attachment'],
  slash_command_menu_view: ['chat_type'],
  slash_command_click: ['chat_type', 'command_type'],
  at_command_menu_view: ['chat_type'],
  at_command_click: ['chat_type', 'command_type'],
} as const satisfies {
  [Event in RigBusinessEventName]: readonly Extract<keyof RigBusinessEventMap[Event], string>[];
};

export function resolveRigBusinessTelemetryPolicy(options: {
  readonly configEnabled?: boolean;
  readonly environment?: NodeJS.ProcessEnv;
}): RigTelemetryPolicy {
  const environment = options.environment ?? process.env;
  const configured = options.configEnabled === true;
  if (isEnabledEnvironmentFlag(environment.RIG_DISABLE_TELEMETRY)) {
    return { enabled: false, configured, blockedBy: 'RIG_DISABLE_TELEMETRY' };
  }
  if (isEnabledEnvironmentFlag(environment.DO_NOT_TRACK)) {
    return { enabled: false, configured, blockedBy: 'DO_NOT_TRACK' };
  }
  return { enabled: configured, configured };
}

export function createRigBusinessTelemetry(
  options: CreateRigBusinessTelemetryOptions,
): RigBusinessTelemetry {
  const fetchImpl = options.fetch ?? fetch;
  const endpoint = resolveRigBusinessTelemetryEndpoint(options.region, options.buildEnv);
  const queueLimit = Math.max(1, options.queueLimit ?? DEFAULT_QUEUE_LIMIT);
  const queue: RigBusinessEvent[] = [];
  let drainPromise: Promise<void> | undefined;
  let drainScheduled = false;

  const drain = async (): Promise<void> => {
    drainScheduled = false;
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) continue;
      try {
        const payload = createSensorsPayload(item, options);
        await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: encodeSensorsRequest(payload),
          signal: AbortSignal.timeout(options.timeoutMs ?? 3_000),
        });
      } catch {
        // Usage reporting must never affect the product flow.
      }
    }
  };

  const scheduleDrain = (): void => {
    if (drainScheduled || drainPromise) return;
    drainScheduled = true;
    queueMicrotask(() => {
      if (!drainScheduled || drainPromise) return;
      drainPromise = drain().finally(() => {
        drainPromise = undefined;
        if (queue.length > 0) scheduleDrain();
      });
    });
  };

  return {
    track(event, properties) {
      if (queue.length >= queueLimit) queue.shift();
      queue.push({ event, properties } as RigBusinessEvent);
      scheduleDrain();
    },
    async flush() {
      drainScheduled = false;
      if (drainPromise) await drainPromise;
      if (queue.length > 0) await drain();
    },
  };
}

export function createRigBusinessTelemetryPreview<Event extends RigBusinessEventName>(
  event: Event,
  properties: RigBusinessEventMap[Event],
  options: CreateRigBusinessTelemetryOptions,
): RigBusinessTelemetryPreview {
  return {
    endpoint: resolveRigBusinessTelemetryEndpoint(options.region, options.buildEnv),
    method: 'POST',
    contentType: 'application/x-www-form-urlencoded',
    payload: createSensorsPayload({ event, properties } as RigBusinessEvent, options),
  };
}

export function bucketRigDuration(durationMs: number): RigDurationBucket {
  if (durationMs < 60_000) return 'under_1m';
  if (durationMs < 5 * 60_000) return '1m_to_5m';
  if (durationMs < 30 * 60_000) return '5m_to_30m';
  return 'over_30m';
}

function createSensorsPayload(
  item: RigBusinessEvent,
  options: CreateRigBusinessTelemetryOptions,
): SensorsPayload {
  const eventProperties = selectEventProperties(item);
  // A fresh ID satisfies the receiver's envelope without linking separate events.
  const eventId = (options.randomId ?? randomUUID)();
  return {
    identities: { $identity_cookie_id: eventId },
    distinct_id: eventId,
    lib: { $lib: 'js', $lib_method: 'code', $lib_version: options.version },
    properties: {
      surface: 'tui',
      os: process.platform,
      region: options.region,
      build_env: options.buildEnv,
      app_version: options.version,
      ...eventProperties,
    },
    type: 'track',
    event: item.event,
    time: (options.now ?? Date.now)(),
  };
}

function selectEventProperties(item: RigBusinessEvent): Record<string, string | number> {
  const selected: Record<string, string | number> = {};
  const properties = item.properties as Record<string, string | number>;
  for (const key of EVENT_PROPERTY_KEYS[item.event]) selected[key] = properties[key]!;
  return selected;
}

export function resolveRigBusinessTelemetryEndpoint(
  region: RigRegion,
  buildEnv: RigBuildEnv,
): string {
  if (region === 'en') {
    return buildEnv === 'prod'
      ? 'https://data.hailuo.ai/meerkat-reporter/api/report?project=RigAgent'
      : 'https://bigdata-test.talkie-ai.com/meerkat-reporter/api/report?project=RigAgent';
  }
  return buildEnv === 'prod'
    ? 'https://data.hailuoai.com/meerkat-reporter/api/report?project=RigAgent'
    : 'https://bigdata-test.xingyeai.com/meerkat-reporter/api/report?project=RigAgent';
}

function isEnabledEnvironmentFlag(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? '');
}

function encodeSensorsRequest(payload: SensorsPayload): string {
  const data = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  return new URLSearchParams({ data, ext: `crc=${javaStringHash(data)}` }).toString();
}

function javaStringHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash &= hash;
  }
  return hash;
}
