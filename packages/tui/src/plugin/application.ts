import type {
  RigPluginCatalog,
  RigPluginMarketplace,
  RigPluginRuntimeAccess,
  RigPluginView,
} from './contract.js';

export class RigPluginApplication {
  constructor(private readonly access: RigPluginRuntimeAccess) {}

  async catalog(input: {
    readonly includeAvailable: boolean;
    readonly marketplace?: RigPluginMarketplace;
  }): Promise<RigPluginCatalog> {
    if (!input.includeAvailable) {
      return {
        installed: await this.access.listInstalledPlugins({
          marketplace: input.marketplace,
        }),
        available: [],
      };
    }
    const marketplaces: readonly RigPluginMarketplace[] = input.marketplace
      ? [input.marketplace]
      : ['official', 'local'];
    const [installed, ...marketplaceCatalogs] = await Promise.all([
      this.access.listInstalledPlugins({ marketplace: input.marketplace }),
      ...marketplaces.map((marketplace) => this.access.listMarketplacePlugins({ marketplace })),
    ]);
    const merged = new Map(
      marketplaceCatalogs.flat().map((plugin) => [plugin.pluginId, plugin] as const),
    );
    for (const plugin of installed) merged.set(plugin.pluginId, plugin);
    return partitionCatalog([...merged.values()]);
  }

  install(plugin: RigPluginView): Promise<RigPluginView> {
    return this.mutate(plugin, 'install');
  }

  remove(plugin: RigPluginView): Promise<RigPluginView> {
    return this.mutate(plugin, 'remove');
  }

  setEnabled(plugin: RigPluginView, enabled: boolean): Promise<RigPluginView> {
    return this.mutate(plugin, enabled ? 'enable' : 'disable');
  }

  refresh(): Promise<void> {
    return this.access.refreshPlugins();
  }

  private async mutate(
    plugin: RigPluginView,
    action: 'install' | 'remove' | 'enable' | 'disable',
  ): Promise<RigPluginView> {
    const result = await this.access.mutatePlugin({
      action,
      plugin: { name: plugin.name, marketplace: plugin.marketplace },
    });
    return { ...plugin, ...result };
  }
}

function partitionCatalog(plugins: readonly RigPluginView[]): RigPluginCatalog {
  const installed: RigPluginView[] = [];
  const available: RigPluginView[] = [];
  for (const plugin of plugins) {
    (plugin.installed ? installed : available).push(plugin);
  }
  return { installed, available };
}
