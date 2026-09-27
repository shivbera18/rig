// Minimal fullscreen screen engine for rig, adapted from the reference
// implementation's alt-screen approach: enter `\x1b[?1049h`, paint the full
// frame on every state change, restore on exit. Deliberately small: ANSI
// width helpers + a Screen class. No React, no component tree.

const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function visibleWidth(s: string): number {
  return [...stripAnsi(s)].length;
}

export function truncateToWidth(s: string, max: number): string {
  if (max <= 0) return "";
  if (visibleWidth(s) <= max) return s;
  if (max === 1) return "…";
  let out = "";
  let w = 0;
  const re = /\x1b\[[0-9;]*m|./gsu;
  for (const tok of s.match(re) ?? []) {
    if (tok.startsWith("\x1b")) {
      out += tok;
      continue;
    }
    if (w + 1 > max - 1) break;
    out += tok;
    w += 1;
  }
  return `${out}…`;
}

export function padToWidth(s: string, width: number): string {
  const w = visibleWidth(s);
  return w >= width ? s : s + " ".repeat(width - w);
}

export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    const push = (): void => {
      out.push(line);
      line = "";
    };
    for (const w of words) {
      if (visibleWidth(line + w) <= width) {
        line += w;
        continue;
      }
      if (line.trim()) push();
      if (visibleWidth(w) <= width) {
        line = w.trimStart();
      } else {
        let chunk = "";
        for (const ch of w) {
          if (visibleWidth(chunk + ch) > width) {
            out.push(chunk);
            chunk = "";
          }
          chunk += ch;
        }
        line = chunk;
      }
    }
    push();
  }
  return out;
}

const ENTER_ALT = "\x1b[?1049h";
const EXIT_ALT = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

export class Screen {
  private active = false;
  private cols = 80;
  private rows = 24;
  private onResize: (() => void) | undefined;

  get width(): number {
    return this.cols;
  }

  get height(): number {
    return this.rows;
  }

  get isActive(): boolean {
    return this.active;
  }

  start(onResize?: () => void): void {
    this.onResize = onResize;
    this.measure();
    process.stdout.write(ENTER_ALT + HIDE_CURSOR);
    this.active = true;
    process.stdout.on("resize", this.handleResize);
  }

  stop(): void {
    process.stdout.removeListener("resize", this.handleResize);
    if (!this.active) return;
    this.active = false;
    process.stdout.write(SHOW_CURSOR + EXIT_ALT);
  }

  paint(lines: string[]): void {
    if (!this.active) return;
    const w = this.cols;
    const h = this.rows;
    let out = "\x1b[H";
    for (let i = 0; i < h; i++) {
      const line = i < lines.length ? (lines[i] ?? "") : "";
      out += `\x1b[${i + 1};1H${padToWidth(truncateToWidth(line, w), w)}`;
    }
    out += `\x1b[${h};1H`;
    process.stdout.write(out);
  }

  private measure(): void {
    this.cols = Math.max(40, process.stdout.columns ?? 80);
    this.rows = Math.max(12, process.stdout.rows ?? 24);
  }

  private handleResize = (): void => {
    this.measure();
    this.onResize?.();
  };
}
