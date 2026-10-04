import { getKeybindings, Key, matchesKey } from "../../engine/public.js";
import type { Component } from "../../rendering/component.js";
import { sanitizeTerminalText } from "../../rendering/terminal-text.js";
import { wrapTextWithAnsi } from "../../rendering/text.js";
import { panelLayout } from "../../widgets/panel-frame.js";
import { tuiChalk as chalk, tuiColors as colors } from "../../theme/runtime.js";

export type TuiProviderOAuthLoginPhase =
  | "starting"
  | "waiting"
  | "failed"
  | "succeeded";

interface TuiProviderOAuthLoginOptions {
  readonly providerName: string;
  openExternalTarget(url: string): Promise<void>;
  onClose(): void;
  requestRender(): void;
}

/**
 * In-session OAuth progress panel (OMP parity: login runs inside the TUI
 * session, not a separate terminal). Shows the authorize URL, waits for the
 * loopback callback, then reports success/failure inline.
 */
export class TuiProviderOAuthLogin implements Component {
  readonly fullscreenViewport = true;
  readonly handlesViewportKeys = true;
  private phase: TuiProviderOAuthLoginPhase = "starting";
  private authUrl: string | undefined;
  private instructions: string | undefined;
  private progress: string | undefined;
  private error: string | undefined;
  private browserHint: string | undefined;
  private openedUrl: string | undefined;
  private disposed = false;
  private cancelling = false;

  constructor(private readonly options: TuiProviderOAuthLoginOptions) {}

  showAuth(url: string, instructions?: string): void {
    if (this.disposed) return;
    this.authUrl = url;
    if (instructions !== undefined) this.instructions = instructions;
    this.phase = "waiting";
    if (url !== this.openedUrl) {
      this.openedUrl = url;
      void this.openBrowser(url);
    }
    this.options.requestRender();
  }

  showProgress(message: string): void {
    if (this.disposed) return;
    this.progress = message;
    this.options.requestRender();
  }

  fail(error: unknown): void {
    if (this.disposed) return;
    this.phase = "failed";
    this.error = sanitizeTerminalText(
      error instanceof Error ? error.message : "Sign-in failed. Retry to continue.",
    );
    this.options.requestRender();
  }

  succeed(): void {
    if (this.disposed) return;
    this.phase = "succeeded";
    this.options.requestRender();
  }

  handleInput(data: string): void {
    if (this.disposed || this.cancelling) return;
    if (getKeybindings().matches(data, "tui.select.cancel")) {
      this.options.onClose();
    } else if (this.phase === "failed" && matchesKey(data, Key.enter)) {
      this.options.onClose();
    } else if (this.phase === "succeeded" && matchesKey(data, Key.enter)) {
      this.options.onClose();
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    return this.renderViewport(width, 20);
  }

  renderViewport(width: number, height: number): string[] {
    const footer =
      this.phase === "failed" || this.phase === "succeeded"
        ? "Enter close · Esc cancel"
        : "Esc cancel";
    const layout = panelLayout(width, height, footer);
    const body =
      this.phase === "starting"
        ? ["Starting sign-in…"]
        : this.phase === "waiting"
          ? [
              ...(this.authUrl ? [sanitizeTerminalText(this.authUrl)] : []),
              this.instructions ? sanitizeTerminalText(this.instructions) : "Complete sign-in in your browser.",
              "Waiting for authorization…",
              ...(this.progress ? [sanitizeTerminalText(this.progress)] : []),
              ...(this.browserHint ? [this.browserHint] : []),
            ]
          : this.phase === "succeeded"
            ? ["Signed in successfully. Press Enter to close."]
            : [this.error ?? "Sign-in failed."];
    if (this.cancelling) return layout.render({ title: `Sign in to ${this.options.providerName}`, body: ["Cancelling sign-in…"] });
    return layout.render(
      { title: `Sign in to ${this.options.providerName}`, body: body.flatMap((line) => wrapTextWithAnsi(line, layout.contentWidth)) },
      this.phase === "failed" ? "error" : "signal",
    );
  }

  dispose(): void {
    this.disposed = true;
  }

  private async openBrowser(url: string): Promise<void> {
    try {
      await this.options.openExternalTarget(url);
    } catch {
      if (this.disposed) return;
      this.browserHint = "Open the link above manually to continue.";
      this.options.requestRender();
    }
  }
}
