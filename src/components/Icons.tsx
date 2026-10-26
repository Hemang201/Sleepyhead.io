import type { SVGProps } from 'react';

/**
 * Hand-rolled inline SVG icons.
 *
 * Kept in the repo (rather than pulled from an icon package) so the bundle stays
 * tiny, icons inherit `currentColor`, and nothing depends on a CDN. Every icon is
 * decorative by default: pass `aria-hidden={false}` and a `title` only when the
 * icon carries meaning on its own.
 */

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number;
  /** Renders a <title> so the icon can be used as the accessible name. */
  title?: string;
}

function Svg({ size = 22, title, children, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function IconController(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.4" y="7" width="19.2" height="10" rx="5" />
      <path d="M7.4 9.9v4.2M5.3 12h4.2" />
      <circle cx="16.4" cy="10.8" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18.7" cy="13.3" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m20 20-4.7-4.7" />
    </Svg>
  );
}

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

export function IconSun(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.4 6.4 4.9 4.9M19.1 19.1l-1.5-1.5M6.4 17.6 4.9 19.1M19.1 4.9l-1.5 1.5" />
    </Svg>
  );
}

export function IconMoon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </Svg>
  );
}

export function IconArrowRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </Svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 20V5M6 11l6-6 6 6" />
    </Svg>
  );
}

export function IconArrowDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v15M6 13l6 6 6-6" />
    </Svg>
  );
}

export function IconMail(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.6" y="5" width="18.8" height="14" rx="2.6" />
      <path d="m3.6 7.4 7.2 5.2a2 2 0 0 0 2.4 0l7.2-5.2" />
    </Svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="9" width="11.4" height="11.4" rx="2.4" />
      <path d="M15 5.6A2.6 2.6 0 0 0 12.4 3H5.6A2.6 2.6 0 0 0 3 5.6v6.8A2.6 2.6 0 0 0 5.6 15" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

export function IconHeart({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...props} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 20s-7.5-4.6-7.5-9.5a4.4 4.4 0 0 1 7.5-3 4.4 4.4 0 0 1 7.5 3C19.5 15.4 12 20 12 20Z" />
    </Svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.6v12.8L19 12 8 5.6Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.4M12 7.8h.01" />
    </Svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.6 3.9a1.6 1.6 0 0 1 2.8 0l8 14A1.6 1.6 0 0 1 20 20.4H4a1.6 1.6 0 0 1-1.4-2.5l8-14Z" />
      <path d="M12 9v4.2M12 16.6h.01" />
    </Svg>
  );
}

export function IconExpand(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5" />
    </Svg>
  );
}

export function IconCollapse(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4v5H4M15 4v5h5M15 20v-5h5M9 20v-5H4" />
    </Svg>
  );
}

export function IconRestart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.4h-4.4" />
    </Svg>
  );
}

export function IconSound(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.6h3.2L12 5.4v13.2L7.2 14.4H4a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1Z" />
      <path d="M16 9.4a3.6 3.6 0 0 1 0 5.2M18.8 7a7.4 7.4 0 0 1 0 10" />
    </Svg>
  );
}

export function IconMute(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9.6h3.2L12 5.4v13.2L7.2 14.4H4a1 1 0 0 1-1-1v-2.8a1 1 0 0 1 1-1Z" />
      <path d="m16.4 9.6 5 4.8M21.4 9.6l-5 4.8" />
    </Svg>
  );
}

export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <circle cx="16" cy="7" r="2.1" />
      <circle cx="10" cy="17" r="2.1" />
    </Svg>
  );
}

export function IconKeyboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.4" y="6.4" width="19.2" height="11.2" rx="2.2" />
      <path d="M6 10h.01M9.4 10h.01M12.8 10h.01M16.2 10h.01M6 13.4h.01M18 13.4h.01M8.6 13.6h6.8" />
    </Svg>
  );
}

export function IconMouse(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7.4" y="3" width="9.2" height="18" rx="4.6" />
      <path d="M12 6.6v3.4" />
    </Svg>
  );
}

export function IconTouch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.6 11.4V5.8a1.7 1.7 0 0 1 3.4 0v5.2" />
      <path d="M13 11V9.6a1.6 1.6 0 0 1 3.2 0v1.6M16.2 11.4a1.6 1.6 0 0 1 3.2 0v3.2A5.4 5.4 0 0 1 14 20h-1.4a4.6 4.6 0 0 1-3.6-1.8l-2.6-3.4a1.7 1.7 0 0 1 2.6-2.1l1.6 1.4" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.4V12l3.4 2.2" />
    </Svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m12 3 8.4 4.6L12 12.2 3.6 7.6 12 3Z" />
      <path d="m4 12.2 8 4.4 8-4.4M4 16.6l8 4.4 8-4.4" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.1" />
    </Svg>
  );
}

export function IconSparkle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.4l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9 1.9-5Z" />
      <path d="M18.6 4v2.8M17.2 5.4H20" />
    </Svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4 10.5 8-6.5 8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1Z" />
    </Svg>
  );
}

export function IconLock(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Svg>
  );
}

export function IconImage(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m5 17 4.5-4.5 3.5 3.5 2.5-2.5L20 17" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 7h15M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7m-8 0 .8 12a1 1 0 0 0 1 1h6.4a1 1 0 0 0 1-1l.8-12" />
    </Svg>
  );
}

export function IconArchive(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M3 4.5h18v3H3z" />
      <path d="M10 12h4" />
    </Svg>
  );
}

export function IconCompass(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.6 8.4-2 5.2-5.2 2 2-5.2 5.2-2Z" />
    </Svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 19.2 6v5.6c0 4.2-2.9 7.5-7.2 9.2-4.3-1.7-7.2-5-7.2-9.2V6L12 3.2Z" />
      <path d="m9.2 12 2 2 3.6-4" />
    </Svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14 4h6v6M20 4l-8.4 8.4" />
      <path d="M18 14.4V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.6" />
    </Svg>
  );
}

/* ------------------------------------------------------------ social icons */

export function IconGithub(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M12 2.6a9.4 9.4 0 0 0-3 18.3c.5.1.7-.2.7-.5v-1.9c-2.7.6-3.3-1.2-3.3-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.4-1.1.6-1.4-2.2-.2-4.5-1.1-4.5-4.8 0-1.1.4-2 1-2.7-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.5.6.7 1 1.6 1 2.7 0 3.7-2.3 4.6-4.5 4.8.4.4.7 1 .7 2v3c0 .3.2.6.7.5A9.4 9.4 0 0 0 12 2.6Z"
        fill="currentColor"
        stroke="none"
      />
    </Svg>
  );
}

export function IconItch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.2 7.6h17.6l-1 3.2H4.2L3.2 7.6Z" />
      <path d="M4.6 10.8 6 19.4h12l1.4-8.6" />
      <path d="M10 14h4" />
    </Svg>
  );
}

export function IconYoutube(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.6" y="5.4" width="18.8" height="13.2" rx="4" />
      <path d="m10.4 9.4 5 2.6-5 2.6V9.4Z" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4l7 8.6L4.4 20h2.2l5.6-6.3L16.6 20H20l-7.2-9L19.4 4h-2.2l-5.2 5.8L8 4H4Z" />
    </Svg>
  );
}

export function IconBluesky(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 10.6C10.9 8.3 8 4.6 5.6 3.5 3.6 2.6 3 4 3 5.6c0 1.3.9 6.7 1.5 8 .8 1.6 2.6 1.8 4.3 1.5-2.9.5-3.6 2.2-1.9 3.9 2 2 3.7-.8 5.1-3 1.4 2.2 3.1 5 5.1 3 1.7-1.7 1-3.4-1.9-3.9 1.7.3 3.5.1 4.3-1.5.6-1.3 1.5-6.7 1.5-8 0-1.6-.6-3-2.6-2.1C16 4.6 13.1 8.3 12 10.6Z" />
    </Svg>
  );
}

export function IconLinkedin(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.2" y="3.2" width="17.6" height="17.6" rx="4" />
      <path d="M7.6 10.4V17M7.6 7.6v.1M11.6 17v-3.6a2.2 2.2 0 0 1 4.4 0V17" />
    </Svg>
  );
}

export function IconMastodon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 15.4c-2.6-.4-4-1.6-4.4-4.2C3.2 8.7 3.4 6 4 4.6 4.9 3.2 7.6 2.8 9 2.8s4.2.3 5.4.6c1.4.4 2.4 1.5 2.8 3 .6 2.7.5 6-.5 8-1.1 2.2-3.3 2.4-4.6 1.8M8 15.4v-4.6c0-1.6.9-2.6 2.6-2.6s2.8 1 2.8 2.6v4.4" />
    </Svg>
  );
}

export function IconDevTo(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.6" y="5.4" width="18.8" height="13.2" rx="3" />
      <path d="M7 14.6V9.4h1.6a1.8 1.8 0 0 1 0 3.5H7m5.2-3.5h2.6m-2.6 2.6h2.6m-2.6 0V9.4m2.6 5.2-.1.1" />
    </Svg>
  );
}

export function IconInstagram(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="3" width="18" height="18" rx="5.2" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.2" cy="6.8" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconDiscord(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.3 6.6a13 13 0 0 0-4.1 1.6C3.6 11.2 3.2 14 3.5 16.6c1.4 1.2 3 2 4.6 2.4l.9-1.6c-.6-.2-1.2-.6-1.7-1" />
      <path d="M14.7 6.6a13 13 0 0 1 4.1 1.6c1.6 3 2 5.8 1.7 8.4-1.4 1.2-3 2-4.6 2.4l-.9-1.6c.6-.2 1.2-.6 1.7-1" />
      <path d="M9.1 6.7c1-.3 2-.5 2.9-.5s1.9.2 2.9.5" />
      <circle cx="9.5" cy="13.1" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13.1" r="1.35" fill="currentColor" stroke="none" />
      <path d="M10.1 17.1c1.2.5 2.6.5 3.8 0" />
    </Svg>
  );
}

export function IconTwitch(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.4 4.2h15.2v10.4l-3.8 3.8h-3l-2.6 2.4H8.2v-2.4H4.4V4.2Z" />
      <path d="M10.4 8.2v4M14.6 8.2v4" />
    </Svg>
  );
}

export function IconReddit(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="13.8" r="7.2" />
      <path d="M12 6.8V4.6l3.6-1" />
      <circle cx="15.9" cy="3.4" r="1.15" />
      <circle cx="9.4" cy="13.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.6" cy="13.2" r="1" fill="currentColor" stroke="none" />
      <path d="M9.2 16.4c1.7 1.3 3.9 1.3 5.6 0" />
    </Svg>
  );
}

export function IconArtStation(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.6 18.6 10.6 5.4l3.1 5.2" />
      <path d="M8.9 18.6h12l-3.3-5.6H12.2" />
    </Svg>
  );
}

export function IconBehance(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.4 6.8h4.1a2.55 2.55 0 0 1 0 5.1H3.4V6.8Zm0 5.1h4.5a2.9 2.9 0 0 1 0 5.8H3.4v-5.8Z" />
      <path d="M14 14.7h6.6a3.3 3.3 0 0 0-6.6 0v.3a3.2 3.2 0 0 0 5.8 1.8" />
      <path d="M15.2 8.1h4.4" />
    </Svg>
  );
}

export function IconDribbble(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 6.4c2.9 3.1 7.6 5 12.6 4.5" />
      <path d="M8.6 20.5c.7-4.6 3.9-8.1 8.4-9" />
      <path d="M14.2 3.3c-2.5 4.4-3.3 9.7-2.2 14.8" />
    </Svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.6 2.6 3.9 5.9 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.9-3.9-9S9.4 5.6 12 3Z" />
    </Svg>
  );
}

export function IconPen(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 20h4L18.6 9.4a2.3 2.3 0 0 0-3.2-3.2L4.8 16.8 4 20Z" />
      <path d="m14.4 7.2 2.4 2.4" />
    </Svg>
  );
}

/**
 * Platform → icon. Keyed by the `platform` stored in the social document, so
 * adding a platform is one entry here plus one entry in `SOCIAL_PLATFORMS`.
 * `website` and `blog` are the deliberate catch-alls for a personal site or a
 * platform the site does not know about yet.
 */
export const SOCIAL_ICONS = {
  github: IconGithub,
  linkedin: IconLinkedin,
  instagram: IconInstagram,
  youtube: IconYoutube,
  x: IconX,
  bluesky: IconBluesky,
  discord: IconDiscord,
  itch: IconItch,
  reddit: IconReddit,
  twitch: IconTwitch,
  artstation: IconArtStation,
  behance: IconBehance,
  dribbble: IconDribbble,
  mastodon: IconMastodon,
  devto: IconDevTo,
  website: IconGlobe,
  blog: IconPen,
  email: IconMail,
} as const;
