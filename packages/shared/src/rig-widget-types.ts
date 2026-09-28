/**
 * rig-widget DSL types — shared contract between daemon (persistence)
 * and UI (parsing + rendering).
 */

export type RigWidgetKind =
  | 'chart'
  | 'map'
  | 'dashboard'
  | 'diagram'
  | 'interactive'
  | 'form'
  | 'mockup';

export type RigWidgetStreamingMode = 'html-first' | 'complete' | 'static';

export type RigWidgetThemeMode = 'app' | 'light' | 'dark' | 'isolated';

export type RigWidgetCapability =
  | 'resize'
  | 'sendPrompt'
  | 'openLink'
  | 'download'
  | 'submitForm';

export type RigWidgetPolicy = 'local-only' | 'inline-only' | 'trusted-cdn';

export interface RigWidgetData {
  name: string;
  type: string;
  content: string;
}

export interface RigWidgetEnvelope {
  version: string;
  kind: RigWidgetKind;
  title: string;
  id?: string;
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  streaming: RigWidgetStreamingMode;
  capabilities?: RigWidgetCapability[];
  theme?: RigWidgetThemeMode;
  tokenSet?: string;
  policy?: RigWidgetPolicy;

  meta?: string;
  style?: string;
  html?: string;
  data?: RigWidgetData[];
  script?: string;
  fallback?: string;
}

export type WidgetContentSegment =
  | { type: 'text'; content: string }
  | { type: 'widget'; envelope: RigWidgetEnvelope }
  | { type: 'widget_incomplete'; raw: string };
