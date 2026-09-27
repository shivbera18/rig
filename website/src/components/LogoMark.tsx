import { LOGO_ALT } from '../content';

export function LogoMark({ size = 30 }: { size?: number }): JSX.Element {
  return (
    <span className="logo-lockup" style={{ gap: 10 }}>
      <img src="./logo.svg" alt="" width={size} height={size} aria-hidden="true" />
      <span className="logo-word">
        rig<sup aria-hidden="true">®</sup>
        <span className="sr-only">{LOGO_ALT}</span>
      </span>
    </span>
  );
}
