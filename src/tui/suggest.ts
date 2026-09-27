import readline from "node:readline";

export interface SuggestState {
  list: Array<[string, string]>;
  idx: number;
  shown: boolean;
}

export function renderSuggestList(
  write: (s: string) => void,
  st: SuggestState,
  dim: string,
  green: string,
  reset: string,
): void {
  write(`${dim}  ${st.list.length} commands — Tab to cycle, Enter to accept${reset}\n`);
  st.list.forEach(([cmd, desc], i) => {
    const mark = i === st.idx ? `${green}›${reset}` : " ";
    write(`${mark} ${green}${cmd}${reset}  ${dim}${desc.slice(0, 60)}${reset}\n`);
  });
}

export function attachSuggest(
  rl: readline.Interface,
  out: { write(s: string): void },
  complete: (frag: string) => Array<[string, string]>,
  dim: string,
  green: string,
  reset: string,
  onHistory: (dir: 1 | -1) => void,
): { clear: () => void; ask: () => void } {
  const st: SuggestState = { list: [], idx: 0, shown: false };
  const clear = (): void => {
    if (!st.shown) return;
    for (let i = 0; i < st.list.length + 2; i++) out.write("\x1b[1A\x1b[2K");
    st.shown = false;
  };
  const render = (frag: string): void => {
    clear();
    if (!frag.startsWith("/")) return;
    st.list = complete(frag.slice(1)).slice(0, 10);
    st.idx = 0;
    if (st.list.length === 0) return;
    renderSuggestList(out.write.bind(out), st, dim, green, reset);
    st.shown = true;
  };
  const cycle = (dir: 1 | -1): void => {
    if (!st.shown || st.list.length === 0) return;
    st.idx = (st.idx + dir + st.list.length) % st.list.length;
    clear();
    renderSuggestList(out.write.bind(out), st, dim, green, reset);
    st.shown = true;
  };
  readline.emitKeypressEvents(process.stdin);
  process.stdin.on("keypress", (_ch: unknown, key?: { name?: string; sequence?: string }) => {
    const line = (rl as unknown as { line?: string }).line ?? "";
    const frag = line.match(/(^|\s)(\/\w*)$/)?.[2];
    if (key?.name === "tab") {
      if (!frag) return;
      cycle(key?.sequence === "\x1b[Z" ? -1 : 1);
      return;
    }
    if (frag) render(frag);
    else if (st.shown) clear();
    if (key?.name === "up") onHistory(-1);
    else if (key?.name === "down") onHistory(1);
  });
  return {
    clear,
    ask: () => {
      st.shown = false;
      rl.prompt();
    },
  };
}
