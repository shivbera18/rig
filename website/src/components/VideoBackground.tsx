import { VIDEO_SRC } from '../content';

export function VideoBackground(): JSX.Element {
  return (
    <div className="bg-stage" aria-hidden="true">
      <video className="bg-video" autoPlay loop muted playsInline>
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      <div className="bg-shade" aria-hidden="true" />
    </div>
  );
}
