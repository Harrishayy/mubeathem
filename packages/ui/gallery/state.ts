import { useCallback, useEffect, useState } from 'react';
import type { Density, Direction, MotionPref, ThemePref } from '../src';

export type Scene = 'all' | 'overbar' | 'sheet' | 'panel' | 'cards' | 'sprout';

export interface GalleryState {
  dir: Direction;
  theme: ThemePref;
  density: Density;
  motion: MotionPref;
  stress: boolean;
  scene: Scene;
  /** Frame width for the catalogue; 0 = full width. */
  vp: number;
  mode: 'collapsed' | 'expanded';
  /** Which fixture the scenes show. */
  view: string;
  play: boolean;
}

const DEFAULTS: GalleryState = { dir: 'honey', theme: 'system', density: 'comfortable', motion: 'system', stress: false, scene: 'all', vp: 0, mode: 'collapsed', view: 'cold', play: false };

function read(): GalleryState {
  const p = new URLSearchParams(location.search);
  const s = { ...DEFAULTS };
  const pick = <K extends keyof GalleryState>(k: K, ok: readonly string[]) => {
    const v = p.get(k);
    if (v && ok.includes(v)) (s as Record<string, unknown>)[k] = v;
  };
  pick('dir', ['honey', 'night', 'signal']);
  pick('theme', ['light', 'dark', 'system']);
  pick('density', ['comfortable', 'compact']);
  pick('motion', ['system', 'reduce', 'full']);
  pick('scene', ['all', 'overbar', 'sheet', 'panel', 'cards', 'sprout']);
  pick('mode', ['collapsed', 'expanded']);
  if (p.get('view')) s.view = p.get('view')!;
  s.stress = p.get('stress') === '1';
  s.play = p.get('play') === '1';
  s.vp = Number(p.get('vp') ?? 0) || 0;
  return s;
}

/** Gallery settings, mirrored to the URL so every state is linkable (and testable). */
export function useGalleryState(): [GalleryState, (patch: Partial<GalleryState>) => void] {
  const [state, setState] = useState(read);
  useEffect(() => {
    const onPop = () => setState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const update = useCallback((patch: Partial<GalleryState>) => {
    setState((s) => {
      const next = { ...s, ...patch };
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(next) as [keyof GalleryState, unknown][]) {
        const d = DEFAULTS[k];
        if (v === d) continue;
        p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
      }
      const q = p.toString();
      history.replaceState(null, '', q ? `?${q}` : location.pathname);
      return next;
    });
  }, []);
  return [state, update];
}
