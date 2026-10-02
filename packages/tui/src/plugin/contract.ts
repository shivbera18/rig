export type RigPluginMarketplace = 'official' | 'local';

export interface RigPluginCapabilities {
  readonly appCount: number;
  readonly mcpServerCount: number;
  readonly skillCount: number;
}

export interface RigPluginView {
  readonly pluginId: string;
  readonly name: string;
  readonly displayName: string;
  readonly marketplace: RigPluginMarketplace;
  readonly version?: string;
  readonly description?: string;
  readonly author?: string;
  readonly installed: boolean;
  readonly enabled: boolean;
  readonly capabilities: RigPluginCapabilities;
}

export interface RigPluginCatalog {
  readonly installed: readonly RigPluginView[];
  readonly available: readonly RigPluginView[];
}

export interface RigPluginRuntimeAccess {
  listInstalledPlugins(input?: {
    readonly marketplace?: RigPluginMarketplace;
  }): Promise<readonly RigPluginView[]>;
  listMarketplacePlugins(input: {
    readonly marketplace: RigPluginMarketplace;
  }): Promise<readonly RigPluginView[]>;
  mutatePlugin(input: {
    readonly action: 'install' | 'remove' | 'enable' | 'disable';
    readonly plugin: { readonly name: string; readonly marketplace: RigPluginMarketplace };
  }): Promise<{ readonly installed: boolean; readonly enabled: boolean }>;
  refreshPlugins(): Promise<void>;
}

export type RigPluginCliRequest =
  | {
      readonly action: 'list';
      readonly marketplace?: RigPluginMarketplace;
      readonly available?: boolean;
      readonly json?: boolean;
    }
  | {
      readonly action: 'add' | 'remove' | 'enable' | 'disable';
      readonly selector: string;
      readonly marketplace?: RigPluginMarketplace;
      readonly json?: boolean;
    }
  | { readonly action: 'marketplace-list'; readonly json?: boolean }
  | {
      readonly action: 'marketplace-upgrade';
      readonly json?: boolean;
    };
