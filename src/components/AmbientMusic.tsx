import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  getAmbientAvailable,
  getAmbientStatus,
  getAmbientVolume,
  setAmbientVolume,
  subscribeAmbient,
  toggleAmbient,
  type AmbientStatus,
} from '../lib/ambient';
import { track } from '../lib/analytics';
import { IconMute, IconSliders, IconSound } from './Icons';

/** What the control says, derived from the real player state. */
export function ambientLabel(status: AmbientStatus): { label: string; hint: string; playing: boolean } {
  switch (status) {
    case 'playing':
      return { label: 'Mute background music', hint: 'Ambient music · on', playing: true };
    case 'loading':
      return { label: 'Stop loading background music', hint: 'Ambient music · starting', playing: true };
    case 'paused':
      return { label: 'Resume background music', hint: 'Ambient music · resume', playing: false };
    case 'blocked':
      return { label: 'Play background music', hint: 'Ambient music · press to play', playing: false };
    case 'error':
      return { label: 'Background music is unavailable', hint: 'Ambient music · unavailable', playing: false };
    default:
      return { label: 'Play background music', hint: 'Ambient music · off', playing: false };
  }
}

interface AmbientMusicProps {
  /** `icon` in the header bar; `wide` inside the mobile menu, where a label helps. */
  variant?: 'icon' | 'wide';
  className?: string;
}

/**
 * The music control.
 *
 * One button, two glyphs, honest states: playing, off, remembered-but-paused
 * (the visitor turned it on before; a reload never starts it by itself),
 * unavailable, and hidden entirely when the owner has switched music off or the
 * configured file is missing. It is a real toggle — no player widget, no fake
 * progress — and it sits beside the theme control so the two "atmosphere"
 * settings read as a pair.
 */
export function AmbientMusic({ variant = 'icon', className }: AmbientMusicProps) {
  const status = useSyncExternalStore(subscribeAmbient, getAmbientStatus, getAmbientStatus);
  const available = useSyncExternalStore(subscribeAmbient, getAmbientAvailable, getAmbientAvailable);
  const { label, hint, playing } = ambientLabel(status);

  if (!available) return null;

  const onClick = () => {
    toggleAmbient();
    track('ambient_music_toggled', { action: playing ? 'off' : 'on', status });
  };

  if (variant === 'wide') {
    return (
      <button
        type="button"
        className={`music-toggle music-toggle--wide ${className ?? ''}`.trim()}
        onClick={onClick}
        aria-pressed={playing}
        aria-label={label}
        data-state={status}
        title={hint}
      >
        {playing ? <IconSound size={18} /> : <IconMute size={18} />}
        <span>{hint}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={`music-toggle ${className ?? ''}`.trim()}
      onClick={onClick}
      aria-pressed={playing}
      aria-label={label}
      data-state={status}
      title={hint}
    >
      {playing ? <IconSound size={18} /> : <IconMute size={18} />}
    </button>
  );
}

/**
 * The volume control.
 *
 * In the header it is a compact button that opens a small framed panel holding
 * the slider — the bar itself stays a bar and never grows a second row. In the
 * mobile menu the same slider is laid out in full. The value is stored on its
 * own key, so stopping the music (or reloading) never discards the level the
 * visitor chose; moving the slider while music plays changes the actual element
 * volume, not a decorative number.
 */
export function AmbientVolume({ variant = 'icon' }: { variant?: 'icon' | 'wide' }) {
  const available = useSyncExternalStore(subscribeAmbient, getAmbientAvailable, getAmbientAvailable);
  const volume = useSyncExternalStore(subscribeAmbient, getAmbientVolume, getAmbientVolume);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on an outside pointer or Escape, returning focus to the trigger.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!available) return null;

  const percent = Math.round(volume * 100);
  const slider = (
    <label className="music-volume__field">
      <span className="music-volume__label">Volume</span>
      <input
        className="music-volume__range"
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(event) => setAmbientVolume(Number(event.target.value) / 100)}
        aria-label="Background music volume"
      />
      <output className="music-volume__value">{percent}%</output>
    </label>
  );

  if (variant === 'wide') {
    return <div className="music-volume music-volume--wide">{slider}</div>;
  }

  return (
    <div className="music-volume">
      <button
        ref={buttonRef}
        type="button"
        className="icon-button music-volume__toggle"
        aria-label="Background music volume"
        aria-expanded={open}
        aria-controls="hg-music-volume"
        title={`Background music volume · ${percent}%`}
        onClick={() => setOpen((current) => !current)}
      >
        <IconSliders size={18} />
      </button>
      {open ? (
        <div className="music-volume__popover" id="hg-music-volume" ref={panelRef} role="group" aria-label="Background music volume">
          {slider}
          <p className="music-volume__hint">Saved on this device, separately from on/off.</p>
        </div>
      ) : null}
    </div>
  );
}
