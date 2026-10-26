import { describe, expect, it } from 'vitest';

import { parseItchEmbedUrl, parseItchProjectUrl } from '../src/shared/itch';

/**
 * These are the two owner-supplied addresses the public player uses. A mistake
 * here is either a dead player or an iframe pointing somewhere it should not,
 * so the accepted grammar is deliberately tiny.
 */
describe('parseItchProjectUrl', () => {
  it('accepts a normal project address and canonicalises it', () => {
    expect(parseItchProjectUrl('https://PixelPine.itch.io/Drift-Game/')).toEqual({
      ok: true,
      value: { url: 'https://pixelpine.itch.io/drift-game', username: 'pixelpine', game: 'drift-game' },
    });
  });

  it('keeps dots, underscores and numbers in the game segment', () => {
    const result = parseItchProjectUrl('https://studio.itch.io/tiny_racer.2');
    expect(result.ok && result.value.url).toBe('https://studio.itch.io/tiny_racer.2');
  });

  it('requires https', () => {
    expect(parseItchProjectUrl('http://studio.itch.io/game')).toMatchObject({ ok: false });
    expect(parseItchProjectUrl('javascript:alert(1)')).toMatchObject({ ok: false });
    expect(parseItchProjectUrl('data:text/html,<script>alert(1)</script>')).toMatchObject({ ok: false });
  });

  it('refuses other domains, including lookalikes', () => {
    for (const value of [
      'https://notitch.io/game',
      'https://studio.itch.io.evil.example/game',
      'https://evil.example/studio.itch.io/game',
      'https://itch.io/game',
      'https://www.itch.io/game',
    ]) {
      expect(parseItchProjectUrl(value), value).toMatchObject({ ok: false });
    }
  });

  it('refuses query strings, fragments, ports and credentials', () => {
    for (const value of [
      'https://studio.itch.io/game?utm_source=x',
      'https://studio.itch.io/game#download',
      'https://studio.itch.io:8443/game',
      'https://user:pass@studio.itch.io/game',
    ]) {
      expect(parseItchProjectUrl(value), value).toMatchObject({ ok: false });
    }
  });

  it('refuses nested paths and non-game pages', () => {
    expect(parseItchProjectUrl('https://studio.itch.io/game/devlog')).toMatchObject({ ok: false });
    expect(parseItchProjectUrl('https://studio.itch.io/')).toMatchObject({ ok: false });
    expect(parseItchProjectUrl('https://studio.itch.io/edit')).toMatchObject({ ok: false });
  });

  it('explains an empty value instead of throwing', () => {
    const result = parseItchProjectUrl('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/itch\.io page address/i);
  });
});

describe('parseItchEmbedUrl', () => {
  it('accepts the official playable iframe address', () => {
    expect(parseItchEmbedUrl('https://itch.io/embed-upload/13923269')).toEqual({
      ok: true,
      value: { url: 'https://itch.io/embed-upload/13923269', id: '13923269' },
    });
  });

  it('keeps a single hex colour and normalises it', () => {
    const result = parseItchEmbedUrl('https://itch.io/embed-upload/42?color=202124');
    expect(result.ok && result.value.url).toBe('https://itch.io/embed-upload/42?color=202124');
  });

  it('rejects the store widget, which cannot be played', () => {
    const result = parseItchEmbedUrl('https://itch.io/embed/42');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/widget/i);
  });

  it('requires the official host and the embed-upload path', () => {
    for (const value of [
      'https://evil.example/embed-upload/42',
      'https://itch.io.evil.example/embed-upload/42',
      'https://itch.io/embed-upload/',
      'https://itch.io/embed-upload/abc',
      'http://itch.io/embed-upload/42',
      'https://itch.io/embed-upload/42/extra',
    ]) {
      expect(parseItchEmbedUrl(value), value).toMatchObject({ ok: false });
    }
  });

  it('refuses unknown parameters and malformed colours', () => {
    expect(parseItchEmbedUrl('https://itch.io/embed-upload/42?foo=bar')).toMatchObject({ ok: false });
    expect(parseItchEmbedUrl('https://itch.io/embed-upload/42?color=red')).toMatchObject({ ok: false });
    expect(parseItchEmbedUrl('https://itch.io/embed-upload/42?color=202124&color=ffffff')).toMatchObject({ ok: false });
  });

  it('refuses credentials, ports and fragments', () => {
    for (const value of [
      'https://user:pass@itch.io/embed-upload/42',
      'https://itch.io:8443/embed-upload/42',
      'https://itch.io/embed-upload/42#x',
    ]) {
      expect(parseItchEmbedUrl(value), value).toMatchObject({ ok: false });
    }
  });
});
