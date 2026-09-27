import { INSTALL_CARDS } from '../content';
import type { CmdCard } from '../content';
import { copyText, useToast } from '../hooks';

function Card({ card }: { card: CmdCard }): JSX.Element {
  const { toast, show } = useToast();
  const onCopy = async (): Promise<void> => {
    show((await copyText(card.copy)) ? `Copied: ${card.copy.slice(0, 48)}` : card.copy);
  };
  return (
    <div className="cmd-card" data-reveal>
      <p className="cmd-label">{card.label}</p>
      <pre>
        <code>{card.lines.join('\n')}</code>
      </pre>
      <button onClick={onCopy} type="button">
        Copy
      </button>
      {toast ? (
        <div className="toast show" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

export function Install(): JSX.Element {
  return (
    <section id="install" className="section band-install">
      <div className="wrap">
        <p className="sec-kicker">Install</p>
        <h2>
          One command. Sixty seconds. <em>A harness.</em>
        </h2>
        <p className="sec-sub">
          Requires Node ≥ 22. Global install gives you the <code>rig</code> binary everywhere.
        </p>
        <div className="cmd-grid">
          {INSTALL_CARDS.map((c) => (
            <Card key={c.label} card={c} />
          ))}
        </div>
      </div>
    </section>
  );
}
