import './styles.css';
import { VideoBackground } from './components/VideoBackground';
import { Nav } from './components/Nav';
import { Hero } from './components/Hero';
import { Install } from './sections/Install';
import { Features } from './sections/Features';
import { Commands } from './sections/Commands';
import { Auth } from './sections/Auth';
import { Finale } from './sections/Finale';
import { useReveals } from './useReveals';

export default function App(): JSX.Element {
  useReveals();
  return (
    <>
      <VideoBackground />
      <Nav />
      <main id="top">
        <Hero />
        <Install />
        <Features />
        <Commands />
        <Auth />
        <Finale />
      </main>
    </>
  );
}
