import { FEATURES } from '../content';

export function Features(): JSX.Element {
  return (
    <section id="features" className="section band-features">
      <div className="wrap">
        <p className="sec-kicker">Why rig</p>
        <h2>
          Built for long runs, <em>not one-shots.</em>
        </h2>
        <div className="feat-grid">
          {FEATURES.map((f) => (
            <article key={f.title} data-reveal>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
