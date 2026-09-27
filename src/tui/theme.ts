// Rig theme: same role set as the reference dark palette, rig hues.
// Brand signal is ember orange (agent-node energy); wordmark gradient runs
// ember → amber → sky; success/warning/error keep universal semantics.

export interface RigPalette {
  brand: string;
  wordmarkHi: string;
  wordmarkMid: string;
  wordmarkLo: string;
  accent: string;
  heading: string;
  code: string;
  link: string;
  userBg: string;
  text: string;
  muted: string;
  dim: string;
  border: string;
  success: string;
  warning: string;
  error: string;
}

export const RIG_DARK: RigPalette = {
  brand: "#f97316",
  wordmarkHi: "#fdba74",
  wordmarkMid: "#f97316",
  wordmarkLo: "#68c0ff",
  accent: "#f97316",
  heading: "#cba6f7",
  code: "#a6e3a1",
  link: "#68c0ff",
  userBg: "#262626",
  text: "#d6d6d6",
  muted: "#adadad",
  dim: "#666666",
  border: "#303030",
  success: "#28c567",
  warning: "#ffc340",
  error: "#ff5e6c",
};

const hex = (n: number): string => n.toString(16).padStart(2, "0");

export function hexFg(rgb: string): string {
  const m = rgb.match(/^#([0-9a-f]{6})$/i);
  if (!m || !m[1]) return "";
  const v = parseInt(m[1], 16);
  return `\u001b[38;2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}m`;
}

// Block-letter RIG wordmark, 6 rows. Gradient applied per row at paint time
// (hi → mid → lo), centered to the widest row like the reference hero.
export const RIG_WORDMARK_FULL = [
  "██████╗ ██╗ ██████╗ ",
  "██╔══██╗██║██╔════╝ ",
  "██████╔╝██║██║  ███╗",
  "██╔══██╗██║██║   ██║",
  "██║  ██║██║╚██████╔╝",
  "╚═╝  ╚═╝╚═╝ ╚═════╝ ",
] as const;

export const RIG_WORDMARK_MEDIUM = [
  "██████╗ ██╗ ██████╗ ",
  "██╔══██╗██║██╔════╝ ",
  "██████╔╝██║██║  ███╗",
  "██║  ██║██║╚██████╔╝",
] as const;

export const RIG_WORDMARK_MICRO = ["RIG"] as const;

export function wordmarkFor(width: number): readonly string[] {
  if (width >= 60) return RIG_WORDMARK_FULL;
  if (width >= 40) return RIG_WORDMARK_MEDIUM;
  return RIG_WORDMARK_MICRO;
}

export function gradientWordmark(p: RigPalette): string[] {
  const rows = [p.wordmarkHi, p.wordmarkHi, p.wordmarkMid, p.wordmarkMid, p.wordmarkLo, p.wordmarkLo];
  return RIG_WORDMARK_FULL.map((line, i) => `${hexFg(rows[i % rows.length] ?? p.brand)}\u001b[1m${line}`);
}

export function centerToWidth(s: string, width: number): string {
  const plain = s.replace(/\u001b\[[0-9;]*m/g, "");
  const w = [...plain].length;
  if (w >= width) return s;
  const pad = Math.floor((width - w) / 2);
  return `${" ".repeat(pad)}${s}`;
}

export function statusColor(): string {
  return `\u001b[38;2;${hex(0x68)};${hex(0xc0)};${hex(0xff)}m`;
}
