/**
 * Generates the site's background music.
 *
 *   node scripts/generate-ambient.mjs
 *
 * Why generate instead of sourcing a track: the piece has to be ours to ship —
 * no licence to track, no attribution to forget, no third-party URL that can
 * disappear. It is a slow four-chord pad (Am9 → Fmaj7 → Cmaj9 → G6) built from
 * detuned sines with soft harmonics, a quiet sub root, and a handful of bell
 * tones. Everything is synthesised here, so the file is reproducible from this
 * script alone.
 *
 * The loop is seamless by construction: the piece is rendered two seconds
 * longer than the loop and the tail is crossfaded back over the head, so the
 * last sample flows into the first without a click or a gap.
 *
 * Output: public/audio/ambient-theme.wav — mono, 22.05 kHz, 16-bit, 24 s
 * (~1 MB). That is deliberate: no encoder is required to produce it, it streams
 * from the same origin, and it is only ever fetched when a visitor turns the
 * music on. Replace the file with an MP3/OGG of your own if you prefer; update
 * `AMBIENT_TRACK` in src/lib/ambient.ts to the new filename.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const SAMPLE_RATE = 22050;
const LOOP_SECONDS = 24;
const CROSSFADE_SECONDS = 2;
const TOTAL_SECONDS = LOOP_SECONDS + CROSSFADE_SECONDS;

const CHORDS = [
  [220.0, 261.63, 329.63, 493.88], // Am9
  [174.61, 220.0, 261.63, 329.63], // Fmaj7
  [130.81, 196.0, 293.66, 329.63], // Cmaj9
  [196.0, 246.94, 293.66, 329.63], // G6
];

/** Deterministic noise: the same file every time this script runs. */
let seed = 0x2f6e2b1;
function random() {
  seed = (seed * 1103515245 + 12345) % 0x80000000;
  return seed / 0x80000000;
}

const frames = Math.round(TOTAL_SECONDS * SAMPLE_RATE);
const loopFrames = Math.round(LOOP_SECONDS * SAMPLE_RATE);
const fadeFrames = Math.round(CROSSFADE_SECONDS * SAMPLE_RATE);
const buffer = new Float64Array(frames);

/** A chord voice: fundamental plus two soft harmonics, slowly breathing. */
function addVoice(startFrame, lengthFrames, frequency, gain, phase) {
  const detune = 1 + (random() - 0.5) * 0.004;
  const f = frequency * detune;
  const lfoRate = 0.05 + random() * 0.07;
  const lfoPhase = random() * Math.PI * 2;
  const harmonic2 = gain * 0.3;
  const harmonic3 = gain * 0.1;

  for (let i = 0; i < lengthFrames; i += 1) {
    const index = startFrame + i;
    if (index < 0 || index >= frames) continue;
    const t = index / SAMPLE_RATE;
    // Cosine fade over the first and last quarter of the voice's window, so a
    // chord change is a swell rather than a cut.
    const edge = Math.min(i, lengthFrames - 1 - i) / (lengthFrames * 0.25);
    const envelope = Math.min(1, Math.max(0, edge)) ** 2;
    const breathe = 1 - 0.22 + 0.22 * Math.sin(2 * Math.PI * lfoRate * t + lfoPhase);
    const w = 2 * Math.PI * f * t + phase;
    buffer[index] +=
      envelope *
      breathe *
      (Math.sin(w) * gain +
        Math.sin(2 * w) * harmonic2 +
        Math.sin(3 * w) * harmonic3 * (1 + 0.2 * Math.sin(2 * Math.PI * 0.03 * t)));
  }
}

const chordFrames = Math.round((LOOP_SECONDS / CHORDS.length) * SAMPLE_RATE);

CHORDS.forEach((chord, chordIndex) => {
  const start = chordIndex * chordFrames;
  // Voices overlap their neighbours by half a chord, so the pad never breathes
  // in silence between changes.
  const length = chordFrames * 2;

  // Sub root, an octave below the chord's root.
  addVoice(start, length, chord[0] / 2, 0.1, random() * Math.PI * 2);

  chord.forEach((frequency, voiceIndex) => {
    addVoice(start + Math.round(voiceIndex * 40), length, frequency, 0.085, random() * Math.PI * 2);
  });

  // One quiet bell at each change: the only bright event in the loop.
  const bellStart = start + Math.round(chordFrames * 0.1);
  const bellLength = Math.round(3.2 * SAMPLE_RATE);
  const bellFrequency = chord[2] * 2;
  for (let i = 0; i < bellLength && bellStart + i < frames; i += 1) {
    const t = i / SAMPLE_RATE;
    const decay = Math.exp((-t / 1.5) * 2.4);
    const attack = Math.min(1, i / (SAMPLE_RATE * 0.06));
    buffer[bellStart + i] +=
      Math.sin(2 * Math.PI * bellFrequency * t) * 0.05 * decay * attack +
      Math.sin(2 * Math.PI * bellFrequency * 2.01 * t) * 0.012 * decay * attack;
  }
});

/* Circular crossfade: fold the two-second tail back over the head. */
for (let i = 0; i < fadeFrames; i += 1) {
  const mix = i / fadeFrames;
  const head = buffer[i];
  const tail = buffer[loopFrames + i] ?? 0;
  buffer[i] = head * Math.sin(mix * Math.PI * 0.5) ** 2 + tail * Math.cos(mix * Math.PI * 0.5) ** 2;
}

// Trim to the loop and normalise to a deliberately quiet ceiling.
const loop = buffer.slice(0, loopFrames);
let peak = 0;
for (let i = 0; i < loop.length; i += 1) peak = Math.max(peak, Math.abs(loop[i]));
const gain = peak > 0 ? 0.32 / peak : 1;

const pcm = Buffer.alloc(loop.length * 2);
for (let i = 0; i < loop.length; i += 1) {
  const value = Math.max(-1, Math.min(1, loop[i] * gain));
  pcm.writeInt16LE(Math.round(value * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16); // PCM chunk size
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(SAMPLE_RATE, 24);
header.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
header.writeUInt16LE(2, 32); // block align
header.writeUInt16LE(16, 34); // bits per sample
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);

const output = 'public/audio/ambient-theme.wav';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, Buffer.concat([header, pcm]));

console.log(
  `${output}: ${LOOP_SECONDS}s, ${SAMPLE_RATE} Hz mono, ${(pcm.length / 1024 / 1024).toFixed(2)} MB, peak ${(0.32).toFixed(2)}`,
);
