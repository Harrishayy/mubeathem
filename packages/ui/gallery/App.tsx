import { useEffect, useState } from 'react';
import { Button, CueRoot, IconButton, SegmentedControl, Sprout, Switch, type Direction, type ThemePref } from '../src';
import { Catalogue } from './Catalogue';
import { useDemoPlayback } from './playback';
import { Scene } from './Scenes';
import { useGalleryState } from './state';

const VIEWPORTS = [
  { value: '0', label: 'Fluid' },
  { value: '320', label: '320' },
  { value: '375', label: '375' },
  { value: '768', label: '768' },
  { value: '1280', label: '1280' },
];

/** Cue's component gallery: every component in every state, under every direction and theme. */
export function App() {
  const [s, set] = useGalleryState();
  const playback = useDemoPlayback(s.play);
  const [menu, setMenu] = useState(false);

  // The gallery page background follows the active direction.
  useEffect(() => {
    document.documentElement.dataset.galleryDir = s.dir;
  }, [s.dir]);

  if (s.scene !== 'all' && s.scene !== 'cards' && s.scene !== 'sprout') {
    return (
      <CueRoot direction={s.dir} theme={s.theme} density={s.density} motion={s.motion} className="g-root g-root--scene">
        <Scene state={s} playback={playback} onMode={(mode) => set({ mode })} />
      </CueRoot>
    );
  }

  return (
    <CueRoot direction={s.dir} theme={s.theme} density={s.density} motion={s.motion} className="g-root">
      <header className="g-bar">
        <div className="g-bar__brand">
          <Sprout state={playback.playing ? 'listening' : 'idle'} size={30} voiceLevel={playback.voiceLevel} decorative />
          <div>
            <p className="g-bar__title">Cue design system</p>
            <p className="g-bar__sub">Gallery · every component, every state</p>
          </div>
          <IconButton className="g-bar__menu" icon={menu ? 'close' : 'settings'} label={menu ? 'Hide controls' : 'Show controls'} onClick={() => setMenu((m) => !m)} />
        </div>
        <div className={`g-bar__controls${menu ? ' is-open' : ''}`}>
          <SegmentedControl<Direction>
            label="Direction"
            size="sm"
            value={s.dir}
            onChange={(dir) => set({ dir })}
            options={[
              { value: 'honey', label: 'Honey' },
              { value: 'night', label: 'Night Shift' },
              { value: 'signal', label: 'Signal' },
            ]}
          />
          <SegmentedControl<ThemePref>
            label="Theme"
            size="sm"
            value={s.theme}
            onChange={(theme) => set({ theme })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
          <SegmentedControl
            label="Density"
            size="sm"
            value={s.density}
            onChange={(density) => set({ density })}
            options={[
              { value: 'comfortable', label: 'Comfy' },
              { value: 'compact', label: 'Compact' },
            ]}
          />
          <SegmentedControl label="Viewport" size="sm" value={String(s.vp)} onChange={(v) => set({ vp: Number(v) })} options={VIEWPORTS} />
          <div className="g-bar__switches">
            <Switch label="Stress strings" checked={s.stress} onCheckedChange={(stress) => set({ stress })} />
            <Switch label="Reduce motion" checked={s.motion === 'reduce'} onCheckedChange={(r) => set({ motion: r ? 'reduce' : 'system' })} />
          </div>
          <div className="g-bar__scenes">
            <Button size="sm" variant="ghost" iconEnd="external" onClick={() => window.open(`?scene=overbar&dir=${s.dir}&theme=${s.theme}`, '_blank')}>
              Overbar on a page
            </Button>
            <Button size="sm" variant="ghost" iconEnd="external" onClick={() => window.open(`?scene=sheet&dir=${s.dir}&theme=${s.theme}`, '_blank')}>
              Phone
            </Button>
            <Button size="sm" variant="ghost" iconEnd="external" onClick={() => window.open(`?scene=panel&dir=${s.dir}&theme=${s.theme}`, '_blank')}>
              Side panel
            </Button>
          </div>
        </div>
      </header>
      <main className="g-main" style={s.vp ? { maxWidth: s.vp } : undefined} data-vp={s.vp || undefined}>
        <Catalogue state={s} playback={playback} only={s.scene === 'all' ? undefined : s.scene} />
      </main>
    </CueRoot>
  );
}
