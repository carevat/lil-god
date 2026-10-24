import { useEffect } from 'react';
import { GameCanvas } from './rendering/Scene';
import {
  TopBar, BottomToolbar, TimeControls, SidePanel, Notifications, Tutorial, WorldMenu,
  StartScreen, KeyboardHandler, HelpOverlay, SuccessionBanner,
} from './components/UI';
import { ForgePanel, MeteorPanel, ShowerBanner } from './components/ForgePanel';
import { Inspector } from './components/Inspector';
import { VisionPanel } from './components/VisionPanel';
import { useGame } from './game/store';
import { loadSettings, saveSettings } from './game/persistence';
import { unlockAudio, setAudioMuted } from './audio';

export default function App() {
  const started = useGame(s => s.started);
  const muted = useGame(s => s.muted);
  const tutorialDone = useGame(s => s.tutorialDone);

  // Restore settings once; start with the side panel collapsed on narrow screens
  useEffect(() => {
    const s = loadSettings();
    useGame.setState({ muted: s.muted, tutorialDone: s.tutorialDone });
    setAudioMuted(s.muted);
    const small = window.matchMedia('(max-width: 760px)');
    const onSize = () => { if (small.matches) useGame.setState({ panelOpen: false }); };
    onSize(); small.addEventListener('change', onSize);
    return () => small.removeEventListener('change', onSize);
  }, []);

  useEffect(() => { saveSettings({ muted, tutorialDone }); }, [muted, tutorialDone]);

  // Browsers only allow audio after a user gesture; also persist the world when leaving the page
  useEffect(() => {
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const save = () => { const g = useGame.getState(); if (g.world) g.saveWorld(false); };
    window.addEventListener('beforeunload', save);
    const onVisibility = () => { if (document.hidden) save(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('beforeunload', save);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: '#090B10' }}>
      <GameCanvas />
      {started && (
        <>
          <TopBar />
          <SidePanel />
          <TimeControls />
          <ShowerBanner />
          <SuccessionBanner />
          <Inspector />
          <VisionPanel />
          <ForgePanel />
          <MeteorPanel />
          <BottomToolbar />
          <Notifications />
          <Tutorial />
          <WorldMenu />
          <HelpOverlay />
          <KeyboardHandler />
        </>
      )}
      <StartScreen />
    </div>
  );
}
