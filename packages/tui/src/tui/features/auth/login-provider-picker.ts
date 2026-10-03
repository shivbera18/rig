import type { RigLoginProviderDef } from "../../../login/provider-login-registry.js";
import { RIG_LOGIN_ORDER, getRigLoginProvider } from "../../../login/provider-login-registry.js";
import { panelLayout } from "../../widgets/panel-frame.js";
import type { Component } from "../../rendering/component.js";
import {
  tuiChalk as chalk,
  tuiColors as colors,
  tuiSelectListTheme as theme,
} from "../../theme/runtime.js";
import { SelectList } from "../../widgets/select-list.js";

/** `/login` provider roster (Step 3): same SelectList + panelLayout pattern as the region picker. */
export class TuiLoginProviderPicker implements Component {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private readonly list: SelectList;
  private readonly defs: readonly RigLoginProviderDef[];

  constructor(onSelect: (def: RigLoginProviderDef) => void, onCancel: () => void) {
    this.defs = RIG_LOGIN_ORDER.map((id) => getRigLoginProvider(id)).filter(
      (def): def is RigLoginProviderDef => def !== undefined,
    );
    this.list = new SelectList(
      this.defs.map((def) => ({ value: def.id, label: def.name })),
      Math.min(this.defs.length, 20),
      theme,
      { minPrimaryColumnWidth: 16, maxPrimaryColumnWidth: 48 },
    );
    this.list.onSelect = (item) => {
      const def = getRigLoginProvider(item.value as string);
      if (def) onSelect(def);
    };
    this.list.onCancel = onCancel;
  }

  handleInput(data: string): void {
    this.list.handleInput(data);
  }

  invalidate(): void {
    this.list.invalidate();
  }

  render(width: number): string[] {
    return this.renderViewport(width, 20);
  }

  renderViewport(width: number, height: number): string[] {
    const layout = panelLayout(width, height, "\u2191\u2193 select \u00b7 Enter continue \u00b7 Esc cancel");
    const helper =
      layout.bodyHeight >= 4
        ? [chalk.hex(colors.muted)("Choose a provider to sign in.")]
        : [];
    return layout.render({
      title: "Choose login provider",
      body: [
        ...helper,
        ...this.list.renderViewport(layout.contentWidth, layout.bodyHeight - helper.length),
      ],
    });
  }
}
