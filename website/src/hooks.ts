import { useCallback, useEffect, useRef, useState } from 'react';

export function useToast(): { toast: string | null; show: (msg: string) => void } {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, show };
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function useTypedLine(phrases: string[]): string {
  const [line, setLine] = useState('');
  useEffect(() => {
    let pi = 0;
    let ci = 0;
    let deleting = false;
    let timer = 0;
    const tick = (): void => {
      const phrase = phrases[pi % phrases.length] ?? '';
      ci += deleting ? -1 : 1;
      setLine(phrase.slice(0, ci));
      let delay = deleting ? 30 : 55;
      if (!deleting && ci >= phrase.length) {
        delay = 1600;
        deleting = true;
      } else if (deleting && ci <= 0) {
        deleting = false;
        pi += 1;
        delay = 400;
      }
      timer = window.setTimeout(tick, delay);
    };
    timer = window.setTimeout(tick, 400);
    return () => window.clearTimeout(timer);
  }, [phrases]);
  return line;
}
