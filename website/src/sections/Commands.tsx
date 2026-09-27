import { useState } from 'react';
import gsap from 'gsap';
import { COMMAND_TABS } from '../content';

export function Commands(): JSX.Element {
  const [active, setActive] = useState(COMMAND_TABS[0]?.id ?? 'session');
  const select = (id: string): void => {
    setActive(id);
    gsap.fromTo(`[data-panel="${id}"]`, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  };
  return (
    <section id="commands" className="section band-commands">
      <div className="wrap">
        <p className="sec-kicker">Command deck</p>
        <h2>
          Everything the session <em>can do.</em>
        </h2>
        <div className="tabs" role="tablist" aria-label="Command groups">
          {COMMAND_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              data-tab={t.id}
              onClick={() => select(t.id)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="tab-panels">
          {COMMAND_TABS.map((t) => (
            <pre key={t.id} data-panel={t.id} data-reveal hidden={t.id !== active}>
              <code>{t.lines.join('\n')}</code>
            </pre>
          ))}
        </div>
      </div>
    </section>
  );
}
