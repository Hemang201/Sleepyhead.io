/**
 * ============================================================================
 *  SITE CONFIGURATION — the single place to edit personal/branding content.
 * ============================================================================
 *
 * Everything you are likely to change lives in this file:
 *   - your name, tagline, contact email
 *   - the production domain (leave empty until you have one)
 *   - default theme + feature toggles
 *   - hero / about / contact / footer copy
 *
 * Social links are NOT here: they are content the owner edits from the
 * dashboard, stored in the database and published from there
 * (`site_content('social')`, edited at /admin/social). Keeping one source of
 * truth is what lets a link be changed without touching code or redeploying.
 *
 * Values marked "PLACEHOLDER" are intentionally not invented for you. Replace
 * them with your real details when you have them; the UI degrades gracefully
 * while they are unset.
 */

export interface NavItem {
  label: string;
  to: string;
  /** Match nested routes (e.g. /games/:slug keeps "Games" active). */
  matchPrefix?: boolean;
}

export interface FeatureToggles {
  /** Site-wide game search overlay (Ctrl/Cmd+K). */
  search: boolean;
  cookieBanner: boolean;
  scrollProgress: boolean;
  backToTop: boolean;
  floatingContact: boolean;
  favourites: boolean;
  recentlyPlayed: boolean;
  serviceWorker: boolean;
  /** Consent-gated analytics hook. No analytics is installed by default. */
  analytics: boolean;
}

export const site = {
  developerName: 'Hemang Gupta',
  /** Shown next to the wordmark; drawn as a lightweight inline SVG. */
  tagline: 'Small games. Big ideas.',

  siteTitle: 'Hemang Gupta — Indie Game Developer & Browser Arcade',
  siteDescription:
    'Independent game developer Hemang Gupta builds small browser games with big ideas: playful mechanics, physics puzzles and interactive experiments you can play instantly.',

  /**
   * Kept empty until a real public address is configured through the dashboard.
   * Public surfaces intentionally render an honest unavailable state instead of
   * printing a fake address. The database contact document is the live source.
   */
  contactEmail: '',

  /**
   * PLACEHOLDER — set this to your real domain (e.g. "https://hemang.dev") to
   * enable canonical URLs, absolute Open Graph URLs and sitemap.xml generation.
   * Leave empty and those are skipped rather than invented.
   */
  productionDomain: '',

  nav: [
    { label: 'Home', to: '/' },
    { label: 'Games', to: '/games', matchPrefix: true },
    { label: 'About', to: '/about' },
    { label: 'Contact', to: '/contact' },
  ] as NavItem[],

  theme: {
    /** 'light' | 'dark' — used before any stored preference is known. */
    default: 'light' as 'light' | 'dark',
    /**
     * A first visit follows the operating system's light/dark preference, which
     * is what `prefers-color-scheme` is for. An explicit choice in the header
     * always wins and is remembered; the inline script in index.html applies the
     * same rule before first paint, so neither case flashes the wrong paper.
     */
    respectSystemOnFirstVisit: true,
  },

  features: {
    search: true,
    cookieBanner: true,
    scrollProgress: true,
    backToTop: true,
    floatingContact: true,
    favourites: true,
    recentlyPlayed: true,
    serviceWorker: true,
    analytics: false,
  } satisfies FeatureToggles,

  hero: {
    /**
     * The two-line statement typed onto the screen on the home page. It is split
     * at the sentence boundary, so the first sentence takes the solid treatment
     * and the second the band's gradient. Keep the punctuation: it is part of
     * the phrase.
     */
    headline: 'SMALL GAMES. BIG IDEAS.',
    /** Sits above the headline; deliberately not the headline itself. */
    eyebrow: 'Indie games. Browser ready.',
    subheadline: 'I build browser games for curious minds.',
    paragraph:
      "I'm an independent game developer exploring playful mechanics, interactive worlds, creative experiments, and games that make people think, laugh, or discover something new.",
    primaryCta: { label: 'Explore My Games', to: '/games' },
    secondaryCta: { label: 'More About Me', to: '/about' },
    labels: ['Instant Play', 'Browser Based', 'Made with Curiosity'],
  },

  about: {
    heading: 'WHO AM I?',
    intro:
      "I'm Hemang Gupta, an independent developer who likes turning small ideas into games you can play in a browser tab within seconds.",
    body: [
      'I spend most of my time experimenting: sketch a mechanic, build the ugliest version that works, then chip away until it feels good in the hand. Prototypes that survive that process become games on this site.',
      "My interests sit between game design and programming — physics puzzles, tiny systems that surprise you, interactive worlds, and the craft of squeezing an idea into something people can learn without a manual. I'm happiest when a mechanic is simple to explain and deep to play.",
      "I'm also endlessly curious about new tools. Browser game development is where much of that curiosity lands right now: no installs, no downloads, just a link you can share with anyone.",
    ],
    skillTags: [
      'Browser game development',
      'Game design',
      'Gameplay programming',
      'Physics & puzzle mechanics',
      'Interactive experiences',
      'Prototyping',
      'Unity',
      'JavaScript',
    ],
    outro: 'Want the longer version, or a look at what I am experimenting with this month?',
    cta: { label: 'More about my work', to: '/about' },
  },

  contact: {
    // Sentence case, like every other heading on the site: the display face
    // already carries the authority, and caps at this size flatten it.
    heading: 'Let’s connect.',
    intro:
      'Whether you found a bug, want to trade ideas about game feel, or have something you think I should build — my inbox is open.',
    reasons: [
      { title: 'Game feedback', body: 'Tell me what worked, what confused you, or what you wish the game did.' },
      { title: 'Collaboration', body: 'Game jams, small teams, art/music pairings, or shared prototypes.' },
      { title: 'Technical discussions', body: 'Canvas, WebGL, physics, performance — happy to talk shop.' },
      { title: 'Project enquiries', body: 'Interactive work, prototypes, or a build you want bringing to the browser.' },
      { title: 'Anything else', body: 'Questions, encouragement, or a good game recommendation.' },
    ],
    responseNote: 'No mailing list, no auto-replies — just email.',
  },

  footer: {
    tagline: 'Independent game developer, building small browser games with big ideas.',
    signOff: 'Built with curiosity.',
  },

  /** Human readable label for the privacy banner. Keep this accurate. */
  privacy: {
    heading: 'Cookies & local storage',
    body: 'This site uses no analytics, advertising or third-party cookies. It only stores a few preferences in your browser — theme, favourite games, recently played titles, filter state and this banner choice — so the arcade feels the way you left it.',
    detail:
      'Those values never leave your device, are not linked to you, and can be cleared at any time from your browser settings.',
    accept: 'Got it',
    dismissalNote: 'Stored locally so the banner stays out of your way.',
  },
};

export type Site = typeof site;

/** True while the contact email is still the shipped placeholder. */
export function isPlaceholderEmail(email: string = site.contactEmail): boolean {
  return email.trim().length === 0 || /your_email|example\.com$/i.test(email.trim());
}
