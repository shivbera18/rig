import { INSTALL_CMD, TYPED_PHRASES } from '../content';
import { copyText, useToast, useTypedLine } from '../hooks';
import pkg from '../../package.json';

export function Hero(): JSX.Element {
  const { toast, show } = useToast();
  const typed = useTypedLine(TYPED_PHRASES);
  const onCopy = async (): Promise<void> => {
    show((await copyText(INSTALL_CMD)) ? `Copied: ${INSTALL_CMD}` : INSTALL_CMD);
  };

  return (
    <section className="hero relative z-10">
      <p className="kicker animate-fade-rise">interactive + headless coding-agent CLI · v{pkg.version}</p>
      <h1 className="animate-fade-rise">
        Where <em>dreams</em> run through the silence.
      </h1>
      <p className="sub animate-fade-rise-delay">
        Bare <code>rig</code> drops you into a persistent session. Forty-five slash commands, streaming answers,
        subagents in isolated worktrees. When the run ends, the thread stays.
      </p>
      <div className="hero-cta animate-fade-rise-delay-2">
        <a className="btn-glass btn-lg" href="#install">
          Begin Journey
        </a>
        <button className="btn-ghost btn-copy" data-copy={INSTALL_CMD} onClick={onCopy} type="button">
          <code>{INSTALL_CMD}</code>
          <span>Copy</span>
        </button>
      </div>
      <div className="hero-terminal animate-fade-rise-delay-2" aria-label="rig session preview">
        <div className="term-bar">
          <span />
          <span />
          <span />
          <em>rig — session mujx0kv8</em>
        </div>
        <pre className="term-body">
          <code>
            <span className="t-dim">$</span> <span className="t-cmd">{typed}</span>
            <span className="caret">▊</span>
            {'\n'}
            <span className="t-dim">· read package.json</span>
            {'\n'}
            <span className="t-dim">· edit src/index.ts</span>
            {'\n'}
            <span className="t-ok">package name is rig</span>
            {'\n'}
            <span className="t-dim">(1.4s · mujx0kv8-4s30iw)</span>
          </code>
        </pre>
      </div>
      {toast ? (
        <div className="toast show" role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
    </section>
  );
}
