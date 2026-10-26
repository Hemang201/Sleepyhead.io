/**
 * Everything the owner edits from the dashboard instead of from source code:
 * the About page, the public contact details, and the decorative background
 * settings.
 *
 * One safe structured format, shared by the dashboard editor, the Worker API and
 * the public site:
 *
 *   - scalars are plain single-line text with a *restricted* inline syntax
 *     (`**bold**`, `*italic*`, `[label](url)`), never raw HTML;
 *   - repeatable content is a list of records with explicit add/remove/reorder
 *     support in the editor;
 *   - every document is normalised and clamped on the server before it is
 *     stored, so a hand-crafted API request cannot store something the editor
 *     could not produce.
 *
 * The two email addresses are deliberately separate documents:
 * `AboutContent`/`ContactContent` hold the *public* contact address that anyone
 * may see, while the owner's *private* authentication address lives in
 * `owner_auth` and is never returned to a browser in full.
 */

import { site } from '../data/site';
import { isMediaStorageValue } from './media';

/* ------------------------------------------------------------- primitives */

/** How long each kind of text field may be, applied on the server too. */
export const CONTENT_LIMITS = {
  eyebrow: 60,
  heading: 80,
  headline: 120,
  tagline: 180,
  intro: 700,
  bioItem: 1400,
  bioItems: 12,
  skills: 24,
  interests: 14,
  projects: 10,
  principles: 6,
  entries: 12,
  links: 12,
  itemText: 90,
  entryTitle: 100,
  entryDetail: 240,
  linkLabel: 60,
  ctaLabel: 40,
  socialLinks: 16,
  socialHeading: 60,
  socialIntro: 240,
  socialLabel: 44,
  socialHandle: 40,
  socialDescription: 160,
  socialUrl: 300,
} as const;

export const LINK_ICONS = [
  'github',
  'itch',
  'youtube',
  'x',
  'bluesky',
  'linkedin',
  'mastodon',
  'devto',
  'mail',
  'link',
] as const;

export type LinkIcon = (typeof LINK_ICONS)[number];

/** Ordered blocks of the About page. Missing ids are hidden. */
export const ABOUT_SECTIONS = [
  'intro',
  'bio',
  'skills',
  'interests',
  'projects',
  'principles',
  'milestones',
  'credentials',
  'links',
] as const;

export type AboutSectionId = (typeof ABOUT_SECTIONS)[number];

export const ABOUT_SECTION_LABELS: Record<AboutSectionId, string> = {
  intro: 'Headline and introduction',
  bio: 'Biography',
  skills: 'Skills and technologies',
  interests: 'Interests',
  projects: 'Current focus',
  principles: 'How I build',
  milestones: 'Milestones',
  credentials: 'Education and professional',
  links: 'Profiles and links',
};

export interface AboutLink {
  label: string;
  url: string;
  icon: LinkIcon;
}

export interface AboutEntry {
  title: string;
  detail: string;
  year: string;
}

export interface AboutPrinciple {
  title: string;
  body: string;
}

export interface AboutContent {
  visible: boolean;
  eyebrow: string;
  heading: string;
  headline: string;
  tagline: string;
  intro: string;
  bio: string[];
  /** Storage reference for the uploaded portrait; the API turns it into a URL. */
  avatarKey: string | null;
  avatarAlt: string;
  skills: string[];
  interests: string[];
  projects: string[];
  principles: AboutPrinciple[];
  milestones: AboutEntry[];
  credentials: AboutEntry[];
  links: AboutLink[];
  cta: { label: string; url: string };
  /** Order and visibility of the blocks above. */
  sections: AboutSectionId[];
}

export interface ContactContent {
  visible: boolean;
  heading: string;
  intro: string;
  responseNote: string;
  /**
   * The PUBLIC contact address, shown to visitors and used by every mailto:
   * link. It is never used for authentication or account recovery.
   */
  email: string;
  reasons: { title: string; body: string }[];
}

export type DecoIntensity = 'low' | 'normal' | 'high';

export interface AppearanceSettings {
  /** Master switch for the decorative background animations. */
  animations: boolean;
  intensity: DecoIntensity;
  /** Fewer, cheaper shapes on small screens and coarse pointers. */
  mobileReduction: boolean;
  parallax: boolean;
}

export const DECO_INTENSITIES: DecoIntensity[] = ['low', 'normal', 'high'];

/* ------------------------------------------------------------------ social */

/**
 * The platforms a link can point at.
 *
 * The key is what is stored; the value is the human name, used as the default
 * label and as the option text in the dashboard. Adding a platform later is a
 * one-line change here plus an icon — nothing else in the footer, the admin page
 * or the API has to know the list exists.
 *
 * `website` is the deliberate catch-all: a personal site, a blog, a forum or a
 * platform nobody has heard of yet. It gets a generic external-link icon and the
 * owner supplies the display name.
 */
export const SOCIAL_PLATFORMS = {
  github: 'GitHub',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  bluesky: 'Bluesky',
  discord: 'Discord',
  itch: 'itch.io',
  reddit: 'Reddit',
  twitch: 'Twitch',
  artstation: 'ArtStation',
  behance: 'Behance',
  dribbble: 'Dribbble',
  mastodon: 'Mastodon',
  devto: 'DEV Community',
  website: 'Website or custom link',
  blog: 'Blog',
  email: 'Email',
} as const;

export type SocialPlatform = keyof typeof SOCIAL_PLATFORMS;

export const SOCIAL_PLATFORM_KEYS = Object.keys(SOCIAL_PLATFORMS) as SocialPlatform[];

export function asSocialPlatform(value: unknown): SocialPlatform {
  return typeof value === 'string' && (SOCIAL_PLATFORM_KEYS as readonly string[]).includes(value)
    ? (value as SocialPlatform)
    : 'website';
}

export interface SocialLink {
  /** Chooses the icon, the default label and how the URL is validated. */
  platform: SocialPlatform;
  /** Display name. Falls back to the platform name when left empty. */
  label: string;
  /** Normalised, safe URL — `https://…`, or `mailto:` for the email platform. */
  url: string;
  /** Optional handle, stored without the leading @. */
  handle: string;
  /** Optional one-line note, shown under the handle. */
  description: string;
  /** A disabled link stays configured but disappears from the public site. */
  enabled: boolean;
}

/**
 * The social section, stored like every other editable document: a draft the
 * owner edits and a published copy the public site reads.
 *
 * The **order of `links` is the display order**. There is no separate position
 * column to drift out of sync with the array the editor renders.
 */
export interface SocialContent {
  /** Master switch for the whole section. */
  visible: boolean;
  heading: string;
  intro: string;
  links: SocialLink[];
}

/* ---------------------------------------------------------------- defaults */

/**
 * What the site shows before the owner edits anything. These are the copy and
 * configuration the project already shipped with, so nothing regresses while
 * the dashboard starts managing it.
 */
export const DEFAULT_ABOUT: AboutContent = {
  visible: true,
  eyebrow: 'The developer',
  heading: 'About me',
  headline: 'Small games. Big ideas.',
  /* The tagline and the intro are separate lines in the layout, so they must
     not ship with the same sentence — that rendered the introduction twice. */
  tagline: site.hero.subheadline,
  intro: site.about.intro,
  bio: [...site.about.body],
  avatarKey: null,
  avatarAlt: `Portrait of ${site.developerName}`,
  skills: [
    'HTML5 Canvas',
    'Web Audio API',
    'JavaScript & TypeScript',
    'Unity',
    'Godot (exploring)',
    'Figma',
    'Git',
  ],
  interests: [
    'One-mechanic prototypes that stay readable at a glance',
    'Systems that teach their own rules instead of explaining them',
    'Narrative loops where progress is noticing, not clicking',
    'Keeping a whole browser build under a few hundred kilobytes',
    'Exports from different engines running identically once published',
  ],
  projects: [
    'Finishing the next browser build — it appears in the library the moment it is published.',
    'Writing about game feel in short sessions — what makes a two-minute game worth replaying.',
    'Keeping this arcade fast on cheap laptops and older phones.',
  ],
  principles: [
    {
      title: 'Start with the mechanic',
      body: 'A game is worth building when one interaction is interesting on its own. I prototype that single idea first, with placeholder shapes, before anything else exists.',
    },
    {
      title: 'Make it legible',
      body: 'If a mechanic needs a paragraph of explanation, it is not ready. The best version of a game is one a stranger can play without being taught.',
    },
    {
      title: 'Ship small, ship honest',
      body: 'Short, finished games beat endless ones. Nothing on this site claims to be more finished than it is — the status labels are real.',
    },
  ],
  milestones: [],
  credentials: [],
  links: [],
  cta: { label: 'Open the arcade', url: '/games' },
  sections: [...ABOUT_SECTIONS],
};

export const DEFAULT_CONTACT: ContactContent = {
  visible: true,
  heading: site.contact.heading,
  intro: site.contact.intro,
  responseNote: site.contact.responseNote,
  /** Empty until the owner sets it: the shipped value is a placeholder. */
  email: '',
  reasons: site.contact.reasons.map((reason) => ({ ...reason })),
};

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  animations: true,
  intensity: 'low',
  mobileReduction: true,
  parallax: true,
};

/**
 * The social section before the owner adds anything.
 *
 * `links` is deliberately empty: no profile, handle or URL is invented, and the
 * public section hides itself until there is something real to show. The heading
 * and the intro are the site's own words, not a placeholder profile.
 */
export const DEFAULT_SOCIAL: SocialContent = {
  visible: true,
  heading: 'Find me on the internet',
  intro: 'The games live here. These are the places I post about building them.',
  links: [],
};

/**
 * The URL a social link is actually stored and rendered with — or `''` when the
 * value is not something this site will link to.
 *
 * Rules, applied identically in the dashboard and on the server:
 *   - a pasted bare domain (`github.com/you`) becomes `https://github.com/you`;
 *   - only `https:` is accepted for external links, so `http:`, `javascript:`,
 *     `data:` and every other scheme are refused rather than sanitised;
 *   - a host must look like a host (it contains a dot) and fragments are dropped,
 *     because `#section` means nothing on someone's profile page;
 *   - the email platform takes an address and stores it as `mailto:`.
 */
export function socialUrlFor(platform: SocialPlatform, value: string): string {
  const raw = value.trim();
  if (!raw) return '';

  if (platform === 'email') {
    const address = raw.replace(/^mailto:/i, '').trim().toLowerCase();
    return isEmail(address) ? `mailto:${address}` : '';
  }

  const looksAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const candidate = looksAbsolute ? raw : `https://${raw}`;
  if (!/^https:\/\//i.test(candidate)) return '';

  try {
    const url = new URL(candidate);
    if (!url.hostname.includes('.')) return '';
    url.hash = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '';
  }
}

/** Key used to spot the same profile entered twice. */
function socialDedupeKey(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase();
}

/**
 * The links a visitor should actually see: the section switched on, the link
 * enabled, and a URL that survived normalisation. A disabled link is kept in the
 * document — the owner can switch it back on without retyping it.
 */
export function enabledSocialLinks(content: SocialContent): SocialLink[] {
  if (!content.visible) return [];
  return content.links.filter((link) => link.enabled && socialUrlFor(link.platform, link.url) !== '');
}

/* ------------------------------------------------------------ text helpers */

/**
 * The only inline formatting the editor supports. Everything is escaped first,
 * so this can never emit a tag the site did not choose to emit.
 */
export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; value: string }
  | { kind: 'em'; value: string }
  | { kind: 'link'; value: string; href: string };

const INLINE_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/;
const INLINE_STRONG = /\*\*([^*\n]+)\*\*/;
const INLINE_EM = /(?<!\*)\*([^*\n]+)\*(?!\*)/;

/** True for URLs the site is willing to put in an href. */
export function isSafeUrl(value: string): boolean {
  const url = value.trim();
  if (!url) return false;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  if (/^#[a-z0-9-]+$/i.test(url)) return true;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url)) return true;
  if (/^tel:\+?[0-9\s()-]{5,20}$/i.test(url)) return true;
  return /^https?:\/\//i.test(url);
}

/**
 * Removes control characters. Written as a filter rather than a regular
 * expression so the intent is explicit: tabs and newlines survive to be collapsed
 * with the rest of the whitespace, every other C0 control and DEL is dropped.
 */
function stripControlCharacters(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const keep = code < 32 ? character === '\t' || character === '\n' || character === '\r' : code !== 127;
    if (keep) out += character;
  }
  return out;
}

/**
 * Strips anything that could be markup and collapses whitespace. Applied to
 * every stored string, so `onclick=`, `<script>` and stray control characters
 * can never reach a page — even through a hand-written API request.
 */
export function plainText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return stripControlCharacters(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Splits a supported inline string into tokens. Escaping happens at render. */
export function parseInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = value;

  while (rest.length > 0) {
    const candidates: { index: number; match: RegExpMatchArray; kind: InlineToken['kind'] }[] = [];
    const link = rest.match(INLINE_LINK);
    if (link?.index !== undefined && isSafeUrl(link[2] ?? '')) candidates.push({ index: link.index, match: link, kind: 'link' });
    const strong = rest.match(INLINE_STRONG);
    if (strong?.index !== undefined) candidates.push({ index: strong.index, match: strong, kind: 'strong' });
    const em = rest.match(INLINE_EM);
    if (em?.index !== undefined) candidates.push({ index: em.index, match: em, kind: 'em' });

    if (candidates.length === 0) break;
    candidates.sort((a, b) => a.index - b.index);
    const next = candidates[0]!;

    if (next.index > 0) tokens.push({ kind: 'text', value: rest.slice(0, next.index) });
    if (next.kind === 'link') tokens.push({ kind: 'link', value: next.match[1] ?? '', href: (next.match[2] ?? '').trim() });
    else tokens.push({ kind: next.kind, value: next.match[1] ?? '' });
    rest = rest.slice(next.index + next.match[0].length);
  }

  if (rest.length > 0) tokens.push({ kind: 'text', value: rest });
  return tokens;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeInlineHtml(value: string): string {
  return escapeHtml(value);
}

/** The inline string with all formatting removed, for meta descriptions. */
export function inlineToPlain(value: string): string {
  return parseInline(value)
    .map((token) => token.value)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------ normalisation */

function strings(value: unknown, max: number, maxLength: number = CONTENT_LIMITS.itemText): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    const text = plainText(entry, maxLength);
    if (text) seen.add(text);
    if (seen.size >= max) break;
  }
  return [...seen];
}

function entries(value: unknown): AboutEntry[] {
  if (!Array.isArray(value)) return [];
  const out: AboutEntry[] = [];
  for (const raw of value.slice(0, CONTENT_LIMITS.entries)) {
    const record = (raw ?? {}) as Record<string, unknown>;
    const title = plainText(record.title, CONTENT_LIMITS.entryTitle);
    const detail = plainText(record.detail, CONTENT_LIMITS.entryDetail);
    const year = plainText(record.year, 20);
    if (!title && !detail) continue;
    out.push({ title: title || detail, detail: title ? detail : '', year });
  }
  return out;
}

export function normaliseAbout(value: unknown): AboutContent {
  const source = (value ?? {}) as Record<string, unknown>;
  const cta = (source.cta ?? {}) as Record<string, unknown>;

  const sections = Array.isArray(source.sections)
    ? [...new Set(source.sections.filter((id): id is AboutSectionId => ABOUT_SECTIONS.includes(id as AboutSectionId)))]
    : [...ABOUT_SECTIONS];

  return {
    visible: source.visible !== false,
    eyebrow: plainText(source.eyebrow, CONTENT_LIMITS.eyebrow),
    heading: plainText(source.heading, CONTENT_LIMITS.heading),
    headline: plainText(source.headline, CONTENT_LIMITS.headline),
    tagline: plainText(source.tagline, CONTENT_LIMITS.tagline),
    intro: plainText(source.intro, CONTENT_LIMITS.intro),
    bio: strings(source.bio, CONTENT_LIMITS.bioItems, CONTENT_LIMITS.bioItem),
    // Either a legacy R2 key under `content/avatar/` or a Get Pronto reference.
    avatarKey: isMediaStorageValue(source.avatarKey, 'content/avatar/') ? (source.avatarKey as string) : null,
    avatarAlt: plainText(source.avatarAlt, CONTENT_LIMITS.entryDetail),
    skills: strings(source.skills, CONTENT_LIMITS.skills),
    interests: strings(source.interests, CONTENT_LIMITS.interests),
    projects: strings(source.projects, CONTENT_LIMITS.projects),
    principles: Array.isArray(source.principles)
      ? source.principles
          .slice(0, CONTENT_LIMITS.principles)
          .map((raw) => {
            const record = (raw ?? {}) as Record<string, unknown>;
            return {
              title: plainText(record.title, CONTENT_LIMITS.entryTitle),
              body: plainText(record.body, CONTENT_LIMITS.bioItem),
            };
          })
          .filter((principle) => principle.title || principle.body)
      : [],
    milestones: entries(source.milestones),
    credentials: entries(source.credentials),
    links: Array.isArray(source.links)
      ? source.links
          .slice(0, CONTENT_LIMITS.links)
          .map((raw) => {
            const record = (raw ?? {}) as Record<string, unknown>;
            const url = plainText(record.url, 300);
            const icon = LINK_ICONS.includes(record.icon as LinkIcon) ? (record.icon as LinkIcon) : 'link';
            return { label: plainText(record.label, CONTENT_LIMITS.linkLabel), url: isSafeUrl(url) ? url : '', icon };
          })
          .filter((link) => link.label && link.url)
      : [],
    cta: {
      label: plainText(cta.label, CONTENT_LIMITS.ctaLabel),
      url: isSafeUrl(plainText(cta.url, 300)) ? plainText(cta.url, 300) : '',
    },
    sections: sections.length > 0 ? sections : [...ABOUT_SECTIONS],
  };
}

export function normaliseContact(value: unknown): ContactContent {
  const source = (value ?? {}) as Record<string, unknown>;
  const email = plainText(source.email, 160).toLowerCase();
  return {
    visible: source.visible !== false,
    heading: plainText(source.heading, CONTENT_LIMITS.heading),
    intro: plainText(source.intro, CONTENT_LIMITS.intro),
    responseNote: plainText(source.responseNote, CONTENT_LIMITS.tagline),
    email: isEmail(email) ? email : '',
    reasons: Array.isArray(source.reasons)
      ? source.reasons
          .slice(0, 8)
          .map((raw) => {
            const record = (raw ?? {}) as Record<string, unknown>;
            return {
              title: plainText(record.title, CONTENT_LIMITS.entryTitle),
              body: plainText(record.body, CONTENT_LIMITS.entryDetail),
            };
          })
          .filter((reason) => reason.title || reason.body)
      : [],
  };
}

export function normaliseSocial(value: unknown): SocialContent {
  const source = (value ?? {}) as Record<string, unknown>;
  const rawLinks = Array.isArray(source.links) ? source.links.slice(0, CONTENT_LIMITS.socialLinks) : [];

  const links: SocialLink[] = [];
  const seen = new Set<string>();

  for (const raw of rawLinks) {
    const record = (raw ?? {}) as Record<string, unknown>;
    const platform = asSocialPlatform(record.platform);
    const url = socialUrlFor(platform, plainText(record.url, CONTENT_LIMITS.socialUrl));
    if (!url) continue;

    // A duplicate URL is dropped rather than stored: two cards pointing at the
    // same profile is never what the owner meant.
    const key = socialDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);

    links.push({
      platform,
      label: plainText(record.label, CONTENT_LIMITS.socialLabel) || SOCIAL_PLATFORMS[platform],
      url,
      handle: plainText(record.handle, CONTENT_LIMITS.socialHandle).replace(/^@+/, ''),
      description: plainText(record.description, CONTENT_LIMITS.socialDescription),
      enabled: record.enabled !== false,
    });
  }

  return {
    visible: source.visible !== false,
    heading: plainText(source.heading, CONTENT_LIMITS.socialHeading),
    intro: plainText(source.intro, CONTENT_LIMITS.socialIntro),
    links,
  };
}

export function normaliseAppearance(value: unknown): AppearanceSettings {
  const source = (value ?? {}) as Record<string, unknown>;
  return {
    animations: source.animations !== false,
    intensity: DECO_INTENSITIES.includes(source.intensity as DecoIntensity) ? (source.intensity as DecoIntensity) : 'low',
    mobileReduction: source.mobileReduction !== false,
    parallax: source.parallax !== false,
  };
}

/* -------------------------------------------------------------- validation */

export interface ContentValidation {
  errors: Record<string, string>;
}

/** Shallow, field-level validation for the editor. The server clamps after this. */
export function validateAbout(value: unknown): ContentValidation {
  const source = (value ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const draft = normaliseAbout(source);

  if (!draft.heading && !draft.headline) errors.heading = 'Give the page a heading or a headline.';
  for (const [key, limit, label] of [
    ['eyebrow', CONTENT_LIMITS.eyebrow, 'Eyebrow'],
    ['heading', CONTENT_LIMITS.heading, 'Heading'],
    ['headline', CONTENT_LIMITS.headline, 'Headline'],
    ['tagline', CONTENT_LIMITS.tagline, 'Tagline'],
  ] as const) {
    const raw = typeof source[key] === 'string' ? (source[key] as string) : '';
    if (raw.trim().length > limit) errors[key] = `${label} must be ${limit} characters or fewer.`;
  }

  if (typeof source.avatarAlt === 'string' && draft.avatarKey && !source.avatarAlt.trim()) {
    errors.avatarAlt = 'Describe the image for screen readers.';
  }

  const rawCta = (source.cta ?? {}) as Record<string, unknown>;
  if (typeof rawCta.url === 'string' && rawCta.url.trim() && !isSafeUrl(rawCta.url)) {
    errors.ctaUrl = 'Use a site path (/games), an https:// URL, or a mailto: address.';
  }
  if (typeof rawCta.label === 'string' && rawCta.label.trim() && !draft.cta.url) {
    errors.ctaUrl = 'Add where the button should lead, or clear the label to hide it.';
  }

  const badLink = Array.isArray(source.links)
    ? source.links.find((raw) => {
        const record = (raw ?? {}) as Record<string, unknown>;
        return typeof record.url === 'string' && record.url.trim() !== '' && !isSafeUrl(record.url);
      })
    : undefined;
  if (badLink) errors.links = 'Links must be https:// URLs, mailto: addresses or site paths.';

  return { errors };
}

/**
 * Field-level checks for the social editor, keyed so the dashboard can put each
 * message on the field it belongs to (`links.2.url`). The server runs this too,
 * so a hand-written request cannot store what the editor would have refused.
 */
export function validateSocial(value: unknown): ContentValidation {
  const source = (value ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const heading = typeof source.heading === 'string' ? source.heading.trim() : '';
  if (heading.length > CONTENT_LIMITS.socialHeading) {
    errors.heading = `Keep the heading under ${CONTENT_LIMITS.socialHeading} characters.`;
  }

  const raw = Array.isArray(source.links) ? source.links : [];
  if (raw.length > CONTENT_LIMITS.socialLinks) {
    errors.links = `That is more than ${CONTENT_LIMITS.socialLinks} links — remove a few first.`;
  }

  const seen = new Map<string, number>();
  raw.slice(0, CONTENT_LIMITS.socialLinks).forEach((entry, index) => {
    const record = (entry ?? {}) as Record<string, unknown>;
    const platform = asSocialPlatform(record.platform);
    const url = typeof record.url === 'string' ? record.url.trim() : '';

    if (!url) {
      errors[`links.${index}.url`] = 'Add the profile address, or remove this link.';
      return;
    }

    const normalised = socialUrlFor(platform, url);
    if (!normalised) {
      errors[`links.${index}.url`] =
        platform === 'email'
          ? 'That does not look like an email address.'
          : 'Use an https:// address — this site will not link to any other scheme.';
      return;
    }

    const key = socialDedupeKey(normalised);
    const first = seen.get(key);
    if (first !== undefined) {
      errors[`links.${index}.url`] = `Already used by link ${first + 1}.`;
    } else {
      seen.set(key, index);
    }

    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (label.length > CONTENT_LIMITS.socialLabel) {
      errors[`links.${index}.label`] = `Keep the name under ${CONTENT_LIMITS.socialLabel} characters.`;
    }
  });

  return { errors };
}

export function validateContact(value: unknown): ContentValidation {
  const source = (value ?? {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const raw = typeof source.email === 'string' ? source.email.trim() : '';
  if (raw && !isEmail(raw)) errors.email = 'That does not look like an email address.';
  return { errors };
}

/* ------------------------------------------------------------------ emails */

export function isEmail(value: string): boolean {
  const email = value.trim();
  if (email.length > 160) return false;
  return /^[^\s@,;:<>()[\]\\]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(email);
}

/**
 * Display form of a private address: enough for the owner to recognise it, not
 * enough to harvest. Used for the authentication address and nothing else.
 */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return email ? '•'.repeat(Math.min(email.length, 6)) : '';
  const visible = local.slice(0, 1);
  const dot = domain.indexOf('.');
  const host = dot === -1 ? domain : domain.slice(0, dot);
  const tld = dot === -1 ? '' : domain.slice(dot);
  return `${visible}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${host.slice(0, 1)}${'•'.repeat(Math.max(3, host.length - 1))}${tld}`;
}

/** Renders supported inline syntax to safe HTML. Everything else is escaped. */
export function renderInline(value: string): string {
  return parseInline(value)
    .map((token) => {
      const text = escapeHtml(token.value);
      switch (token.kind) {
        case 'strong':
          return `<strong>${text}</strong>`;
        case 'em':
          return `<em>${text}</em>`;
        case 'link': {
          const external = /^https?:\/\//i.test(token.href);
          const rel = external ? ' rel="noreferrer noopener"' : '';
          const target = external ? ' target="_blank"' : '';
          return `<a href="${escapeHtml(token.href)}"${target}${rel}>${text}</a>`;
        }
        default:
          return text;
      }
    })
    .join('');
}
