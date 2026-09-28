export const RIG_DEFAULT_AGENT_NAME = 'rig';

export interface TuiProductContext {
  surface: 'cli' | 'tui' | 'headless';
  defaultAgentName: string;
}

export function createTuiProductContext(
  surface: TuiProductContext['surface'],
  overrides: Partial<Pick<TuiProductContext, 'defaultAgentName'>> = {},
): TuiProductContext {
  return {
    surface,
    defaultAgentName: overrides.defaultAgentName ?? RIG_DEFAULT_AGENT_NAME,
  };
}
