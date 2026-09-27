import { AUTH_CARDS } from '../content';
import { copyText, useToast } from '../hooks';

export function Auth(): JSX.Element {
  const { toast, show } = useToast();
  return (
    <section id="auth" className="section band-auth">
      <div className="wrap">
        <p className="sec-kicker">Auth that survives reality</p>
        <h2>
          Keys today. <em>OAuth when ready.</em>
        </h2>
        <p className="sec-sub">
          <code>opencode-zen</code> takes an API key now. OAuth providers activate via env client IDs, then{' '}
          <code>rig login</code> just works.
        </p>
        <div className="cmd-grid">
          {AUTH_CARDS.map((c) => (
            <div key={c.label} className="cmd-card" data-reveal>
              <p className="cmd-label">{c.label}</p>
              <pre>
                <code>{c.lines.join('\n')}</code>
              </pre>
              <button
                onClick={async () => show((await copyText(c.copy)) ? `Copied: ${c.copy}` : c.copy)}
                type="button"
              >
                Copy
              </button>
            </div>
          ))}
        </div>
      </div>
      {toast ? (
        <div className="toast show" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </section>
  );
}
