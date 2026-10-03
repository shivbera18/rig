import { useEffect, useRef } from 'react';
import { VIDEO_SRC } from '../content';

export function VideoBackground(): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.muted = true;
    const play = (): void => {
      void video.play().catch(() => undefined);
    };
    play();
    video.addEventListener('canplay', play);
    document.addEventListener('visibilitychange', play);
    const resume = (): void => play();
    window.addEventListener('touchend', resume, { once: true });
    return () => {
      video.removeEventListener('canplay', play);
      document.removeEventListener('visibilitychange', play);
      window.removeEventListener('touchend', resume);
    };
  }, []);

  return (
    <div className="bg-stage" aria-hidden="true">
      <video ref={ref} className="bg-video" autoPlay loop muted playsInline disablePictureInPicture>
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>
      <div className="bg-shade" aria-hidden="true" />
    </div>
  );
}
