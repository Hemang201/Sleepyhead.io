import { describe, expect, it } from 'vitest';

import { SOCIAL_ICONS } from '../src/components/Icons';

import {
  CONTENT_LIMITS,
  DEFAULT_SOCIAL,
  SOCIAL_PLATFORMS,
  SOCIAL_PLATFORM_KEYS,
  asSocialPlatform,
  enabledSocialLinks,
  normaliseSocial,
  socialUrlFor,
  validateSocial,
  type SocialContent,
} from '../src/shared/site-content';

/**
 * The social document's rules, tested where they are enforced rather than where
 * they are typed.
 *
 * Two of these matter more than the rest: a URL that reaches storage is a URL
 * the public site will put in an `href`, so anything that is not `https:` (or a
 * `mailto:` on the email platform) has to be refused rather than cleaned up; and
 * nothing may be invented, which is why the shipped document has no links at all.
 */

const link = (over: Partial<SocialContent['links'][number]> = {}) => ({
  platform: 'github' as const,
  label: 'GitHub',
  url: 'https://github.com/example',
  handle: 'example',
  description: '',
  enabled: true,
  ...over,
});

describe('socialUrlFor', () => {
  it('keeps a valid https URL, minus its fragment', () => {
    expect(socialUrlFor('github', 'https://github.com/example/projects#readme')).toBe(
      'https://github.com/example/projects',
    );
  });

  it('assumes https for a pasted bare domain', () => {
    expect(socialUrlFor('website', 'example.dev/work')).toBe('https://example.dev/work');
  });

  it('refuses every scheme that is not https', () => {
    for (const value of [
      'http://example.dev',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      'file:///etc/passwd',
    ]) {
      expect(socialUrlFor('website', value), value).toBe('');
    }
  });

  it('completes a value typed without a scheme, including a socket-relative one', () => {
    // Both forms are what an owner pastes out of a browser address bar. Neither
    // is a scheme-relative bypass: the result is an https URL on the host that was
    // typed, which is exactly what the link was meant to point at.
    expect(socialUrlFor('github', '//github.com/example')).toBe('https://github.com/example');
    expect(socialUrlFor('github', 'github.com/example')).toBe('https://github.com/example');
  });

  it('refuses a host that is not a host', () => {
    expect(socialUrlFor('website', 'localhost')).toBe('');
    expect(socialUrlFor('website', 'https://localhost/profile')).toBe('');
  });

  it('refuses whitespace and empty values', () => {
    expect(socialUrlFor('github', '   ')).toBe('');
    expect(socialUrlFor('github', 'https://git hub.com/you')).toBe('');
  });

  it('treats the email platform as an address, not a URL', () => {
    expect(socialUrlFor('email', 'someone@example.com')).toBe('mailto:someone@example.com');
    expect(socialUrlFor('email', 'mailto:Someone@Example.COM')).toBe('mailto:someone@example.com');
    expect(socialUrlFor('email', 'not-an-address')).toBe('');
    expect(socialUrlFor('email', 'https://example.com')).toBe('');
  });

  it('refuses an https URL on the email platform', () => {
    expect(socialUrlFor('email', 'https://example.com/contact')).toBe('');
  });
});

describe('normaliseSocial', () => {
  it('drops links whose URL cannot be used', () => {
    const social = normaliseSocial({
      links: [link(), link({ url: 'javascript:alert(1)' }), link({ platform: 'x', url: '' })],
    });
    expect(social.links).toHaveLength(1);
    expect(social.links[0]?.platform).toBe('github');
  });

  it('drops a duplicate URL rather than storing two cards for one profile', () => {
    const social = normaliseSocial({
      links: [link(), link({ platform: 'x', label: 'X', url: 'https://github.com/example/' })],
    });
    expect(social.links).toHaveLength(1);
    expect(social.links[0]?.label).toBe('GitHub');
  });

  it('falls back to the platform name when no label is given', () => {
    const social = normaliseSocial({ links: [link({ label: '   ' })] });
    expect(social.links[0]?.label).toBe(SOCIAL_PLATFORMS.github);
  });

  it('unknowns become the generic website platform', () => {
    const social = normaliseSocial({ links: [link({ platform: 'myspace' as never })] });
    expect(social.links[0]?.platform).toBe('website');
  });

  it('stores a handle without the leading @', () => {
    const social = normaliseSocial({ links: [link({ handle: '@@example' })] });
    expect(social.links[0]?.handle).toBe('example');
  });

  it('keeps a disabled link in the document', () => {
    const social = normaliseSocial({ links: [link({ enabled: false })] });
    expect(social.links[0]?.enabled).toBe(false);
  });

  it('defaults a link to enabled', () => {
    const social = normaliseSocial({ links: [link({ enabled: undefined as never })] });
    expect(social.links[0]?.enabled).toBe(true);
  });

  it('cannot be pushed past the link limit', () => {
    const links = Array.from({ length: CONTENT_LIMITS.socialLinks + 6 }, (_, index) =>
      link({ url: `https://example.com/${index}`, platform: 'website' }),
    );
    expect(normaliseSocial({ links }).links).toHaveLength(CONTENT_LIMITS.socialLinks);
  });

  it('strips markup out of every stored string', () => {
    const social = normaliseSocial({
      heading: '<script>alert(1)</script>Find me',
      intro: 'Hi <b>there</b>',
      links: [link({ label: '<img src=x onerror=alert(1)>Labels', description: '<i>note</i>' })],
    });
    expect(social.heading).toBe('alert(1) Find me');
    expect(social.intro).toBe('Hi there');
    expect(social.links[0]?.label).not.toMatch(/[<>]/);
    expect(social.links[0]?.description).toBe('note');
  });

  it('preserves the order it is given', () => {
    const social = normaliseSocial({
      links: [link({ platform: 'itch', url: 'https://a.example/1' }), link({ platform: 'x', url: 'https://a.example/2' })],
    });
    expect(social.links.map((entry) => entry.platform)).toEqual(['itch', 'x']);
  });
});

describe('enabledSocialLinks', () => {
  const content: SocialContent = {
    visible: true,
    heading: 'Find me',
    intro: '',
    links: [link(), link({ platform: 'x', url: 'https://x.com/example', enabled: false })],
  };

  it('returns only what is switched on and usable', () => {
    expect(enabledSocialLinks(content).map((entry) => entry.platform)).toEqual(['github']);
  });

  it('returns nothing at all when the section is switched off', () => {
    expect(enabledSocialLinks({ ...content, visible: false })).toEqual([]);
  });

  it('ignores a stored URL that would not survive normalisation', () => {
    const tampered: SocialContent = { ...content, links: [{ ...link(), url: 'javascript:alert(1)' }] };
    expect(enabledSocialLinks(tampered)).toEqual([]);
  });
});

describe('validateSocial', () => {
  it('accepts a complete link', () => {
    expect(validateSocial({ heading: 'Find me', links: [link()] }).errors).toEqual({});
  });

  it('asks for a URL on the row it is missing from', () => {
    const errors = validateSocial({ links: [link({ url: '' })] }).errors;
    expect(errors['links.0.url']).toMatch(/profile address/i);
  });

  it('refuses an unsafe scheme with an explanation', () => {
    const errors = validateSocial({ links: [link({ url: 'javascript:alert(1)' })] }).errors;
    expect(errors['links.0.url']).toMatch(/https/);
  });

  it('points at the first link when a URL is repeated', () => {
    const links = [link(), link({ platform: 'website', url: 'https://github.com/example/' })];
    expect(validateSocial({ links }).errors['links.1.url']).toBe('Already used by link 1.');
  });

  it('reports an over-long heading and label', () => {
    const heading = 'x'.repeat(CONTENT_LIMITS.socialHeading + 1);
    const links = [link({ label: 'y'.repeat(CONTENT_LIMITS.socialLabel + 1) })];
    const errors = validateSocial({ heading, links }).errors;
    expect(errors.heading).toMatch(/under/);
    expect(errors['links.0.label']).toMatch(/under/);
  });

  it('refuses more links than the document allows', () => {
    const links = Array.from({ length: CONTENT_LIMITS.socialLinks + 1 }, (_, index) =>
      link({ url: `https://example.com/${index}`, platform: 'website' }),
    );
    expect(validateSocial({ links }).errors.links).toMatch(/more than/);
  });
});

describe('the shipped document', () => {
  it('invents no profile at all', () => {
    expect(DEFAULT_SOCIAL.links).toEqual([]);
  });

  it('offers every platform a name and an icon', () => {
    for (const key of SOCIAL_PLATFORM_KEYS) {
      expect(SOCIAL_PLATFORMS[key], key).toBeTruthy();
      // A platform without an icon would silently fall back to a generic mark.
      expect(Object.keys(SOCIAL_ICONS), key).toContain(key);
    }
  });

  it('treats an unknown platform as the generic one', () => {
    expect(asSocialPlatform('not-a-platform')).toBe('website');
  });
});
