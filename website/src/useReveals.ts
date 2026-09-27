import { useEffect } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

// Scroll reveals only. The background video is fixed fullscreen and never
// moves: it stays fully visible behind every section.
export function useReveals(): void {
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('[data-reveal]').forEach((el, i) => {
        gsap.fromTo(
          el,
          { opacity: 0, y: 28 },
          {
            opacity: 1,
            y: 0,
            duration: 0.7,
            ease: 'power3.out',
            delay: (i % 3) * 0.06,
            scrollTrigger: { trigger: el, start: 'top 88%' },
          },
        );
      });
    });
    return () => ctx.revert();
  }, []);
}
