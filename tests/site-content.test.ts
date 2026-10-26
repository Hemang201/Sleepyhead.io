import { describe, expect, it } from 'vitest';

import {
  ABOUT_SECTIONS,
  CONTENT_LIMITS,
  DEFAULT_ABOUT,
  DEFAULT_APPEARANCE,
  DEFAULT_CONTACT,
  isEmail,
  isSafeUrl,
  maskEmail,
  normaliseAbout,
  normaliseAppearance,
  normaliseContact,
  renderInline,
  validateAbout,
  validateContact,
} from '../src/shared/site-content';

/**
 * The rules the editor, the API and the public pages all share.
 *
 * The important ones are security-shaped: whatever reaches `normaliseAbout` is
 * what gets stored and later rendered, so a hand-written API request has to be
 * unable to store markup, a script URL or an unbounded blob.
 */

describe('plainText sanitisation via normaliseAbout', () => {
  it('strips tags, event handlers and control characters', () => {
    const about = normaliseAbout({
      heading: '<script>alert(1)</script>Hello\u0000 <b>world</b>',
      intro: '<img src=x onerror="alert(1)">Real text',
    });

    expect(about.heading).not.toContain('<');
    expect(about.heading).not.toContain('>');
    expect(about.heading).toContain('Hello');
    expect(about.heading).not.toContain('\u0000');
    expect(about.intro).not.toContain('onerror');
    expect(about.intro).toContain('Real text');
  });

  it('collapses whitespace and trims', () => {
    expect(normaliseAbout({ headline: '  a   b \n\n c  ' }).headline).toBe('a b c');
  });

  it('clamps every scalar to its documented limit', () => {
    const about = normaliseAbout({
      eyebrow: 'x'.repeat(500),
      heading: 'y'.repeat(500),
      headline: 'z'.repeat(500),
      avatarAlt: 'a'.repeat(500),
    });

    expect(about.eyebrow.length).toBe(CONTENT_LIMITS.eyebrow);
    expect(about.heading.length).toBe(CONTENT_LIMITS.heading);
    expect(about.headline.length).toBe(CONTENT_LIMITS.headline);
    expect(about.avatarAlt.length).toBe(CONTENT_LIMITS.entryDetail);
  });
});

describe('normaliseAbout lists', () => {
  it('deduplicates, clamps and drops empty entries', () => {
    const about = normaliseAbout({
      skills: ['Canvas', 'Canvas', '', '  ', 'Web Audio'],
      bio: Array.from({ length: 40 }, (_, index) => `Paragraph ${index}`),
    });

    expect(about.skills).toEqual(['Canvas', 'Web Audio']);
    expect(about.bio.length).toBe(CONTENT_LIMITS.bioItems);
  });

  it('only accepts the supported section ids and always keeps at least one', () => {
    expect(normaliseAbout({ sections: ['bio', 'nonsense', 'links', 'bio'] }).sections).toEqual(['bio', 'links']);
    expect(normaliseAbout({ sections: [] }).sections).toEqual([...ABOUT_SECTIONS]);
    expect(normaliseAbout({}).sections).toEqual([...ABOUT_SECTIONS]);
  });

  it('keeps a milestone only when it has content, and promotes a detail-only entry', () => {
    const about = normaliseAbout({
      milestones: [
        { title: '', detail: '', year: '' },
        { title: '', detail: 'Shipped a thing', year: '2025' },
        { title: 'Won a jam', detail: '', year: '' },
      ],
    });

    expect(about.milestones).toEqual([
      { title: 'Shipped a thing', detail: '', year: '2025' },
      { title: 'Won a jam', detail: '', year: '' },
    ]);
  });

  it('drops links and calls to action that are not safely addressable', () => {
    const about = normaliseAbout({
      links: [
        { label: 'Bad', url: 'javascript:alert(1)', icon: 'github' },
        { label: 'Also bad', url: '//evil.example', icon: 'github' },
        { label: 'Good', url: 'https://github.com/example', icon: 'github' },
        { label: 'No url', url: '', icon: 'github' },
      ],
      cta: { label: 'Play', url: 'javascript:alert(1)' },
    });

    expect(about.links.map((link) => link.label)).toEqual(['Good']);
    expect(about.cta).toEqual({ label: 'Play', url: '' });
  });

  it('refuses an avatar key that is not one of ours', () => {
    expect(normaliseAbout({ avatarKey: 'builds/other-thing/index.html' }).avatarKey).toBeNull();
    expect(normaliseAbout({ avatarKey: 'content/avatar/abc.png' }).avatarKey).toBe('content/avatar/abc.png');
  });
});

describe('validateAbout', () => {
  it('asks for a heading or a headline', () => {
    expect(validateAbout({ heading: '', headline: '' }).errors.heading).toBeTruthy();
    expect(validateAbout({ heading: 'About me' }).errors).toEqual({});
  });

  it('rejects an unsafe call-to-action destination', () => {
    expect(validateAbout({ heading: 'A', cta: { label: 'Go', url: 'javascript:alert(1)' } }).errors.ctaUrl).toBeTruthy();
    expect(validateAbout({ heading: 'A', cta: { label: 'Go', url: '/games' } }).errors).toEqual({});
  });

  it('asks for alternative text when a portrait is set', () => {
    const errors = validateAbout({ heading: 'A', avatarKey: 'content/avatar/a.png', avatarAlt: '' }).errors;
    expect(errors.avatarAlt).toBeTruthy();
  });

  it('rejects absurdly long scalars before clamping quietly', () => {
    expect(validateAbout({ heading: 'x'.repeat(CONTENT_LIMITS.heading + 1) }).errors.heading).toBeTruthy();
  });
});

describe('contact content', () => {
  it('accepts a real address and rejects everything else', () => {
    expect(normaliseContact({ email: 'hello@example.com' }).email).toBe('hello@example.com');
    expect(normaliseContact({ email: 'HELLO@Example.COM' }).email).toBe('hello@example.com');
    expect(normaliseContact({ email: 'not-an-address' }).email).toBe('');
    expect(normaliseContact({ email: 'a@b' }).email).toBe('');
    expect(normaliseContact({ email: 'a b@example.com' }).email).toBe('');
    expect(validateContact({ email: 'nope' }).errors.email).toBeTruthy();
    expect(validateContact({ email: '' }).errors).toEqual({});
  });

  it('ships the owner’s real public address, not a placeholder', () => {
    expect(DEFAULT_CONTACT.email).toBe('hemanggupta40863@gmail.com');
    expect(isEmail(DEFAULT_CONTACT.email)).toBe(true);
  });

  it('keeps the public address out of the About document entirely', () => {
    // The private authentication address is never part of any content document;
    // the About default has no email field to leak.
    expect(Object.keys(DEFAULT_ABOUT)).not.toContain('email');
    expect(normaliseAbout({ email: 'someone@example.com' })).not.toHaveProperty('email');
  });
});

describe('maskEmail', () => {
  it('never returns the whole address', () => {
    const masked = maskEmail('owner@example.com');
    expect(masked).not.toBe('owner@example.com');
    expect(masked).not.toContain('owner');
    expect(masked).toContain('@');
    expect(masked).toContain('.');
  });

  it('handles odd input without throwing', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('no-at-sign')).toBe('••••••');
  });
});

describe('isSafeUrl', () => {
  it('allows site paths, anchors, mailto, tel and http(s)', () => {
    for (const url of ['/games', '/about?preview=1', '#top', 'mailto:a@b.com', 'tel:+441234567890', 'https://x.dev']) {
      expect(isSafeUrl(url), url).toBe(true);
    }
  });

  it('refuses script URLs, protocol-relative URLs and other schemes', () => {
    for (const url of ['javascript:alert(1)', '//evil.example', 'data:text/html,x', 'vbscript:x', 'ftp://x', '']) {
      expect(isSafeUrl(url), url).toBe(false);
    }
  });
});

describe('renderInline', () => {
  it('escapes everything it does not deliberately format', () => {
    const html = renderInline('<script>alert("x")</script> & "quoted"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('renders the three supported inline styles', () => {
    expect(renderInline('**bold**')).toBe('<strong>bold</strong>');
    expect(renderInline('*italic*')).toBe('<em>italic</em>');
    expect(renderInline('[Play](/games)')).toBe('<a href="/games">Play</a>');
  });

  it('marks external links as safe to open and leaves them noopener', () => {
    const html = renderInline('[site](https://example.com)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it('does not linkify an unsafe URL', () => {
    const html = renderInline('[click](javascript:alert(1))');
    expect(html).not.toContain('<a');
    expect(html).toContain('javascript:alert(1)');
  });

  it('leaves an unmatched marker as literal text', () => {
    expect(renderInline('2 * 3 = 6')).toBe('2 * 3 = 6');
  });
});

describe('appearance settings', () => {
  it('defaults to restrained and enabled', () => {
    expect(DEFAULT_APPEARANCE).toEqual({ animations: true, intensity: 'low', mobileReduction: true, parallax: true });
  });

  it('falls back to the restrained intensity for anything unknown', () => {
    expect(normaliseAppearance({ intensity: 'extreme' }).intensity).toBe('low');
    expect(normaliseAppearance({ intensity: 'high' }).intensity).toBe('high');
    expect(normaliseAppearance({}).intensity).toBe('low');
  });

  it('treats only an explicit false as off', () => {
    expect(normaliseAppearance({ animations: false }).animations).toBe(false);
    expect(normaliseAppearance({ animations: 'nope' }).animations).toBe(true);
    expect(normaliseAppearance({ mobileReduction: false }).mobileReduction).toBe(false);
    expect(normaliseAppearance({ parallax: false }).parallax).toBe(false);
  });
});
