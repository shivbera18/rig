import { LogoMark } from './LogoMark';

const LINKS = [
  { href: '#top', label: 'Home', active: true },
  { href: '#install', label: 'Install' },
  { href: '#features', label: 'Features' },
  { href: '#commands', label: 'Commands' },
  { href: '#auth', label: 'Auth' },
];

export function Nav(): JSX.Element {
  return (
    <header className="nav relative z-10">
      <div className="nav-inner">
        <a className="logo-link" href="#top" aria-label="rig home">
          <LogoMark />
        </a>
        <nav className="nav-links" aria-label="Primary">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={l.active ? 'active' : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
        <a className="btn-glass btn-sm" href="#install">
          Begin Journey
        </a>
      </div>
    </header>
  );
}
