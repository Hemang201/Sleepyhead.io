import { describe, expect, it } from 'vitest';

import {
  BUNDLED_TRACK,
  DEFAULT_MUSIC,
  MUSIC_LIMITS,
  MUSIC_MEDIA_PATH,
  normaliseMusic,
  publicMusic,
} from '../src/shared/music';

/**
 * The music document is owner data read on every public page, so it has to be
 * defensive: a half-written row must degrade to something playable (or to
 * silence), never to a player pointing at an empty key.
 */
describe('normaliseMusic', () => {
  it('treats a missing document as the bundled track', () => {
    expect(DEFAULT_MUSIC.source).toBe('bundled');
    expect(DEFAULT_MUSIC.enabled).toBe(true);
    expect(publicMusic(DEFAULT_MUSIC, true).url).toBe(BUNDLED_TRACK);
  });

  it('keeps an uploaded track and its metadata', () => {
    const config = normaliseMusic({
      title: '  Night  loop ',
      source: 'uploaded',
      storageKey: 'music/abc-123.mp3',
      contentType: 'audio/mpeg',
      byteSize: 2048,
      enabled: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(config).toMatchObject({
      title: 'Night loop',
      source: 'uploaded',
      storageKey: 'music/abc-123.mp3',
      contentType: 'audio/mpeg',
      byteSize: 2048,
      enabled: true,
    });
  });

  it('rejects a storage key outside the music prefix', () => {
    const config = normaliseMusic({ source: 'uploaded', storageKey: '../../builds/secret/index.html', enabled: true });
    expect(config.source).toBe('none');
    expect(config.enabled).toBe(false);
    expect(config.storageKey).toBeNull();
  });

  it('treats an uploaded document with no key as removed rather than falling back', () => {
    const config = normaliseMusic({ source: 'uploaded', storageKey: null, enabled: true, title: 'Gone' });
    expect(config.source).toBe('none');
    expect(config.enabled).toBe(false);
    expect(publicMusic(config, true).url).toBeNull();
  });

  it('cannot enable a document with no source', () => {
    const config = normaliseMusic({ source: 'none', enabled: true });
    expect(config.enabled).toBe(false);
    expect(config.source).toBe('none');
  });

  it('clamps the title instead of storing an unbounded string', () => {
    const config = normaliseMusic({ title: 'x'.repeat(400), enabled: true });
    expect(config.title.length).toBe(MUSIC_LIMITS.maxTitle);
  });

  it('falls back to a readable title when one is missing', () => {
    expect(normaliseMusic({ enabled: true }).title).toBe(DEFAULT_MUSIC.title);
  });
});

describe('publicMusic', () => {
  it('never exposes the storage key', () => {
    const config = normaliseMusic({
      source: 'uploaded',
      storageKey: 'music/track-1.mp3',
      updatedAt: '2026-02-02T10:00:00.000Z',
      enabled: true,
    });
    const view = publicMusic(config, true);
    expect(JSON.stringify(view)).not.toContain('music/track-1.mp3');
    expect(view.url).toBe(`${MUSIC_MEDIA_PATH}?v=2026-02-02T10%3A00%3A00.000Z`);
  });

  it('fails silently when the stored object is gone', () => {
    const config = normaliseMusic({ source: 'uploaded', storageKey: 'music/track-1.mp3', enabled: true });
    expect(publicMusic(config, false)).toMatchObject({ enabled: false, url: null });
  });

  it('returns no URL when the owner has disabled music', () => {
    const config = normaliseMusic({ source: 'bundled', enabled: false });
    expect(publicMusic(config, true)).toMatchObject({ enabled: false, url: null });
  });
});
