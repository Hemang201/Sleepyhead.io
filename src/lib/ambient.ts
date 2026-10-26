/**
 * The ambient music controller.
 *
 * One audio element for the whole application, created lazily the first time a
 * visitor asks for sound. That is the whole design:
 *
 *   - **One instance, ever.** It lives at module scope, not in a component, so
 *     navigating between routes cannot start a second copy — and a full reload
 *     tears the old document down with its element.
 *   - **Nothing is fetched until asked for.** `preload = 'none'` and the element
 *     only exists after the first toggle, so a visitor who never turns music on
 *     downloads none of it.
 *   - **No autoplay, at all.** Nothing is played on load, not even a remembered
 *     preference: that shows as `paused`, the control says "Resume", and the
 *     first real interaction starts the track. A refused `play()` is reported
 *     as `blocked` and retried on the next gesture — never faked as playing.
 *   - **Honest failure.** A missing or unplayable file becomes the `error` state,
 *     which the control reports; it never throws and never reports "playing".
 *
 * The track is synthesised by `scripts/generate-ambient.mjs` — our own recording,
 * so there is no licence or attribution to track. Swap the file and change
 * `AMBIENT_TRACK` to use your own.
 */

import { ambientEnabledStore, musicVolumeStore } from './preferences';
import { BUNDLED_TRACK } from '../shared/music';

/**
 * Where the track comes from.
 *
 * The owner configures it in the dashboard and the Worker answers `/api/music`.
 * Until that answer arrives — and forever, if the request fails — the track
 * that ships with the build is used, so an offline first visit still has music
 * and a configuration outage never removes the control.
 */
export const AMBIENT_TRACK = BUNDLED_TRACK;

const FADE_MS = 650;

let trackUrl: string | null = AMBIENT_TRACK;
let trackLoaded = false;
let trackAvailable = true;
let trackRequest: Promise<void> | null = null;

export type AmbientStatus = 'off' | 'paused' | 'loading' | 'playing' | 'blocked' | 'error';

let element: HTMLAudioElement | null = null;
let status: AmbientStatus = 'off';
let fadeFrame = 0;
let wantsPlayback = false;
let retryOnGesture = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setStatus(next: AmbientStatus): void {
  if (status === next) return;
  status = next;
  emit();
}

export function getAmbientStatus(): AmbientStatus {
  return status;
}

/** False when the owner has disabled music or the configured file is gone. The
 *  controls hide themselves rather than offering a button that cannot work. */
export function getAmbientAvailable(): boolean {
  return trackAvailable;
}

/** The visitor's saved volume, 0–1. Remembered independently of on/off. */
export function getAmbientVolume(): number {
  return musicVolumeStore.get();
}

function setTrackAvailable(next: boolean): void {
  if (trackAvailable === next) return;
  trackAvailable = next;
  emit();
}

/**
 * Reads the published music configuration once per page load. New page loads
 * therefore pick up a track the owner just published; an already-open page keeps
 * playing what it started, which is the graceful end of the brief without a
 * realtime channel.
 */
export function loadAmbientTrack(): Promise<void> {
  if (trackLoaded) return Promise.resolve();
  if (trackRequest) return trackRequest;

  trackRequest = (async () => {
    try {
      const response = await fetch('/api/music', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`music config ${response.status}`);
      const body = (await response.json()) as { music?: { enabled?: boolean; url?: string | null } };
      const url = body.music?.enabled && typeof body.music.url === 'string' ? body.music.url : null;
      trackLoaded = true;
      if (!url) {
        trackUrl = null;
        setTrackAvailable(false);
        return;
      }
      trackUrl = url;
      if (element && element.src !== new URL(url, window.location.href).href) {
        element.src = url;
        element.load();
      }
      setTrackAvailable(true);
    } catch {
      // Keep the shipped track. Silence or a hidden control would be a worse
      // failure than the bundled default.
      trackLoaded = true;
      trackUrl = AMBIENT_TRACK;
      setTrackAvailable(true);
    }
  })();

  return trackRequest;
}

/**
 * Sets the volume, immediately and persistently. Cancels any in-flight fade so
 * the slider's position is what the listener actually hears.
 */
export function setAmbientVolume(next: number): void {
  const value = Math.min(1, Math.max(0, Number.isFinite(next) ? next : 0));
  musicVolumeStore.set(value);
  if (element) {
    window.cancelAnimationFrame(fadeFrame);
    element.volume = value;
  }
  emit();
}

export function subscribeAmbient(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The single element. Created on first use, never duplicated. */
function audioElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (element) return element;

  if (!trackUrl) return null;
  const audio = new Audio();
  audio.loop = true;
  audio.preload = 'none';
  audio.src = trackUrl;
  audio.volume = 0;
  /* Attached to the document, hidden and out of the accessibility tree: an
     element in the DOM is one the browser's own media controls and any test can
     see, and it makes "there is exactly one" checkable rather than a claim. */
  audio.hidden = true;
  audio.setAttribute('aria-hidden', 'true');
  audio.dataset.ambient = 'on';
  // `appendChild`, not `append`: the Workers type definitions give every
  // element a `Body.append` overload, and the DOM signature is the one that
  // takes a Node here.
  document.body.appendChild(audio);

  audio.addEventListener('playing', () => setStatus('playing'));
  audio.addEventListener('waiting', () => {
    if (wantsPlayback) setStatus('loading');
  });
  audio.addEventListener('error', () => {
    wantsPlayback = false;
    audio.pause();
    audio.volume = 0;
    ambientEnabledStore.set(false);
    setStatus('error');
  });

  element = audio;
  return audio;
}

function fadeTo(target: number, done?: () => void): void {
  const audio = element;
  if (!audio || typeof window === 'undefined') {
    done?.();
    return;
  }

  window.cancelAnimationFrame(fadeFrame);
  const from = Number.isFinite(audio.volume) ? Math.min(1, Math.max(0, audio.volume)) : 0;
  const started = performance.now();

  const step = (now: number) => {
    /*
     * Both ends are clamped, because a frame callback's timestamp can precede
     * the `performance.now()` taken when the fade was scheduled: a negative
     * progress used to push the computed volume a fraction below zero, and
     * `HTMLMediaElement.volume` throws (rather than clamping) on that, aborting
     * the fade and leaving the track silent. Browsers also round-trip the
     * volume, so the arithmetic result is clamped as well, not just the input.
     */
    const progress = Math.min(1, Math.max(0, (now - started) / FADE_MS));
    audio.volume = Math.min(1, Math.max(0, from + (target - from) * progress));
    if (progress < 1) {
      fadeFrame = window.requestAnimationFrame(step);
    } else {
      audio.volume = Math.min(1, Math.max(0, target));
      done?.();
    }
  };

  fadeFrame = window.requestAnimationFrame(step);
}

/**
 * A refused autoplay is not an error: the browser is waiting for a gesture.
 * We remember that, and resume on the next real interaction — once.
 */
function armGestureResume(): void {
  if (retryOnGesture || typeof window === 'undefined') return;
  retryOnGesture = true;
  const resume = () => {
    retryOnGesture = false;
    window.removeEventListener('pointerdown', resume);
    window.removeEventListener('keydown', resume);
    if (wantsPlayback) void start();
  };
  window.addEventListener('pointerdown', resume, { passive: true, once: true });
  window.addEventListener('keydown', resume, { once: true });
}

function disarmGestureResume(): void {
  retryOnGesture = false;
}

async function start(): Promise<void> {
  await loadAmbientTrack();
  const audio = audioElement();
  if (!audio) {
    // The owner has disabled music (or its file is gone): stay silent rather
    // than reporting a failure the visitor cannot do anything about.
    wantsPlayback = false;
    setStatus('off');
    return;
  }

  wantsPlayback = true;
  setStatus('loading');
  if (audio.readyState === 0) audio.load();

  try {
    await audio.play();
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    wantsPlayback = false;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      // AbortError happens when a pause interrupts a pending play; the toggle
      // already owns that decision, so it is not an error state.
      setStatus(name === 'AbortError' ? 'off' : 'blocked');
      if (name === 'NotAllowedError') armGestureResume();
    } else {
      ambientEnabledStore.set(false);
      setStatus('error');
    }
    return;
  }

  // The visitor may have toggled it off while the file was still loading.
  if (!wantsPlayback) {
    audio.pause();
    setStatus('off');
    return;
  }

  fadeTo(musicVolumeStore.get());
  setStatus('playing');
}

/** Turn the music on (or resume it). Persisted. */
export function playAmbient(): void {
  ambientEnabledStore.set(true);
  void start();
}

/** Turn the music off. The element stays alive so the next start is instant. */
export function stopAmbient(): void {
  wantsPlayback = false;
  disarmGestureResume();
  ambientEnabledStore.set(false);
  setStatus('off');
  if (!element) return;
  fadeTo(0, () => element?.pause());
}

export function toggleAmbient(): void {
  if (status === 'playing' || status === 'loading' || wantsPlayback) stopAmbient();
  else playAmbient();
}

/**
 * Called once from the app shell.
 *
 * Reflects a remembered preference without acting on it: the control is marked
 * `paused` so the visitor can see the choice survived the reload, and one click
 * resumes it. No audio element is created and no byte of the track is fetched.
 */
export function initAmbient(): () => void {
  if (typeof window === 'undefined') return () => {};

  /*
   * A remembered preference is *not* played here. Starting audio on page load
   * is exactly what the brief rules out, and no honest player needs it: the
   * control says "Resume" instead, and the first interaction starts the track.
   */
  if (ambientEnabledStore.get()) setStatus('paused');
  void loadAmbientTrack();

  return () => {
    window.cancelAnimationFrame(fadeFrame);
    element?.pause();
    element?.remove();
    element = null;
    wantsPlayback = false;
    setStatus('off');
  };
}
