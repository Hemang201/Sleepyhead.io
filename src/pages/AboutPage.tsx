import { Link } from 'react-router-dom';

import { site } from '../data/site';
import { useCatalogue } from '../lib/catalogue';
import { useSiteContent } from '../lib/site-content';
import { playableGames } from '../lib/library';
import { ControllerArt, ZigZag } from '../components/Decorations';
import { EmailCard } from '../components/EmailCard';
import { Seo } from '../components/Seo';
import {
  enabledSocialLinks,
  inlineToPlain,
  renderInline,
  type AboutContent,
  type AboutSectionId,
  type LinkIcon,
  type SocialPlatform,
} from '../shared/site-content';
import { SOCIAL_ICONS, IconArrowRight, IconExternal, IconMail } from '../components/Icons';

/**
 * The About page.
 *
 * Every word, image, tag and link on this page is stored in the database and
 * edited from the dashboard (Site content → About page). Nothing personal is
 * hardcoded here: the shipped default is the copy this project already had, and
 * it is replaced the moment the owner publishes their own.
 *
 * Two details worth knowing when reading this file:
 *   - inline formatting is rendered through `renderInline`, which escapes the
 *     text and then emits only `<strong>`, `<em>` and safe `<a>` elements, so
 *     stored content can never inject markup;
 *   - optional blocks are simply absent when they are empty, and the section
 *     order is whatever the owner arranged.
 */

type IconComponent = (props: { size?: number }) => React.ReactElement;

/** Maps a stored link icon to a component, with a safe fallback. */
function iconFor(icon: LinkIcon): IconComponent {
  if (icon === 'mail') return IconMail;
  if (icon === 'link') return IconExternal;
  return (SOCIAL_ICONS[icon as Exclude<LinkIcon, 'mail' | 'link'>] ?? IconExternal) as IconComponent;
}

/**
 * The social platforms that have a dedicated icon on the About link list, which
 * uses its own smaller icon vocabulary. Anything else (a forum, a personal site)
 * falls back to the generic external-link mark.
 */
const LINK_ICON_FOR_PLATFORM: Partial<Record<SocialPlatform, LinkIcon>> = {
  github: 'github',
  itch: 'itch',
  youtube: 'youtube',
  x: 'x',
  bluesky: 'bluesky',
  linkedin: 'linkedin',
  mastodon: 'mastodon',
  devto: 'devto',
  email: 'mail',
};

/** Rendered text with the restricted inline syntax applied. */
function Rich({ text, as: Tag = 'p', className, style }: { text: string; as?: 'p' | 'span' | 'li'; className?: string; style?: React.CSSProperties }) {
  return <Tag className={className} style={style} dangerouslySetInnerHTML={{ __html: renderInline(text) }} />;
}

function SectionTitle({ eyebrow, title, id, index }: { eyebrow: string; title: string; id: string; index: string }) {
  return (
    <header className="sec-head">
      <span className="sec-head__index" aria-hidden="true">
        {index}
      </span>
      <div className="sec-head__body">
        <p className="section__eyebrow">{eyebrow}</p>
        <h2 className="section__title" id={id}>
          {title}
        </h2>
      </div>
    </header>
  );
}

const ORDER: AboutSectionId[] = [
  'intro',
  'bio',
  'skills',
  'interests',
  'projects',
  'principles',
  'milestones',
  'credentials',
  'links',
];

function sectionVisible(about: AboutContent, id: AboutSectionId): boolean {
  if (!about.sections.includes(id)) return false;
  switch (id) {
    case 'bio':
      return about.bio.length > 0;
    case 'skills':
      return about.skills.length > 0;
    case 'interests':
      return about.interests.length > 0;
    case 'projects':
      return about.projects.length > 0;
    case 'principles':
      return about.principles.length > 0;
    case 'milestones':
      return about.milestones.length > 0;
    case 'credentials':
      return about.credentials.length > 0;
    case 'links':
      return true;
    default:
      return true;
  }
}

export default function AboutPage() {
  const { about, avatar, social } = useSiteContent();
  const { games } = useCatalogue();
  const playable = playableGames(games);

  const ordered = ORDER.filter((id) => sectionVisible(about, id));
  // The About page prefers its own curated link list; when the owner has not
  // written one, the published social links stand in rather than showing nothing.
  const links =
    about.links.length > 0
      ? about.links
      : enabledSocialLinks(social).map((link) => ({
          label: link.label,
          url: link.url,
          icon: LINK_ICON_FOR_PLATFORM[link.platform] ?? 'link',
        }));

  const summary = inlineToPlain(about.intro || about.tagline || site.siteDescription).slice(0, 300);
  const plain = (value: string | undefined) =>
    inlineToPlain(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
  const showTagline =
    about.tagline.length > 0 && plain(about.tagline) !== plain(about.intro) && plain(about.tagline) !== plain(about.headline);

  if (!about.visible) {
    return (
      <div className="page">
        <Seo title={`About ${site.developerName}`} description={summary} path="/about" />
        <div className="container">
          <div className="page-state" style={{ marginTop: 'var(--space-8)' }}>
            <h1 className="section__title">About is hidden right now</h1>
            <p className="section__lead">
              The About page has been switched off in the dashboard. The games and the rest of the site are unaffected.
            </p>
            <Link className="btn btn--primary" to="/games">
              Browse the games
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    /* Violet leads the About band, with cyan as its counterweight and one warm
       accent reserved for the milestones — the section reads warmer than the
       library and calmer than the contact band. */
    <div className="page scheme--about">
      <Seo
        title={`${about.heading || `About ${site.developerName}`} — how I build games | ${site.developerName}`}
        description={summary || 'An independent game developer’s approach to design, prototyping and browser games.'}
        path="/about"
        image={avatar?.url.startsWith('/') ? avatar.url : undefined}
      />

      <div className="container deco-host">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li aria-current="page">About</li>
          </ol>
        </nav>

        <section className="split split--about" aria-labelledby="about-title" data-reveal-group>
          <div className="stack stack--lg">
            <div>
              {about.eyebrow ? <p className="section__eyebrow">{about.eyebrow}</p> : null}
              <h1 className="section__title" id="about-title">
                {about.heading || 'About me'}
              </h1>
            </div>

            {about.headline ? (
              <Rich text={about.headline} style={{ fontSize: 'var(--step-1)', color: 'var(--text)' }} />
            ) : null}

            {/* The tagline and the intro are two lines in one column. If an owner
                stores the same sentence in both, show it once rather than twice —
                duplicated copy reads as a bug, not as emphasis. */}
            {showTagline ? <Rich text={about.tagline} style={{ fontSize: 'var(--step-1)' }} /> : null}
            {about.intro ? <Rich text={about.intro} style={{ color: 'var(--text-muted)' }} /> : null}

            {ordered.includes('bio')
              ? about.bio.map((paragraph, index) => (
                  <Rich key={index} text={paragraph} style={{ color: 'var(--text-muted)' }} />
                ))
              : null}

            {ordered.includes('skills') ? (
              <div>
                <span className="field__label">Technologies and tools</span>
                <ul className="about-tags" style={{ marginTop: 'var(--space-3)' }}>
                  {about.skills.map((skill) => (
                    <li key={skill}>
                      <span className="chip">{skill}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {ordered.includes('interests') ? (
              <div>
                <span className="field__label">Areas I work in</span>
                {/* Statements, not tags: a ruled index reads as a list of
                    positions, where nine filled pills read as a tag cloud. */}
                <ul className="about-index" style={{ marginTop: 'var(--space-3)' }}>
                  {about.interests.map((interest, index) => (
                    <li className="about-index__item" key={interest}>
                      <span className="about-index__number" aria-hidden="true">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>{interest}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {about.cta.url && about.cta.label ? (
              <div className="cluster">
                <Link className="btn btn--primary" to={about.cta.url}>
                  {about.cta.label}
                  <IconArrowRight size={16} />
                </Link>
              </div>
            ) : null}
          </div>

          <aside className="stack stack--lg" aria-label="Portrait and current work">
            <div className="panel panel--chunky deco-host" style={{ overflow: 'hidden' }}>
              {avatar ? (
                <img
                  className="about-avatar"
                  src={avatar.url}
                  alt={avatar.alt}
                  width={520}
                  height={520}
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <>
                  <ControllerArt />
                  <p style={{ color: 'var(--text-dim)', fontSize: 'var(--step--2)', textAlign: 'center' }}>
                    No portrait uploaded yet — add one in the dashboard and it appears here.
                  </p>
                </>
              )}
            </div>

            {ordered.includes('projects') ? (
              <div className="panel">
                <p className="panel__title">Currently</p>
                <ul className="instruction-list" style={{ marginTop: 'var(--space-4)' }}>
                  {about.projects.map((project, index) => (
                    <li key={index}>
                      <Rich text={project} as="span" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </section>

        {ordered.includes('principles') ? (
          <>
            <hr className="divider" />
            <section className="section section--tight" aria-labelledby="philosophy-heading">
              <header className="sec-head" data-reveal>
                <span className="sec-head__index" aria-hidden="true">
                  04
                </span>
                <div className="sec-head__body">
                  <p className="section__eyebrow">Philosophy</p>
                  <h2 className="section__title" id="philosophy-heading">
                    How I build
                  </h2>
                </div>
              </header>

              <div className="principle-grid">
                {about.principles.map((principle, index) => (
                  <article className="principle" key={`${principle.title}-${index}`}>
                    <span className="principle__index">0{index + 1}</span>
                    <h3>{principle.title}</h3>
                    <Rich text={principle.body} />
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {ordered.includes('milestones') || ordered.includes('credentials') ? (
          <section className="section section--tight" aria-labelledby="history-heading" data-reveal>
            <SectionTitle index="05" eyebrow="Background" title="Milestones & experience" id="history-heading" />
            <div className="split split--about" style={{ marginTop: 'var(--space-5)' }}>
              {ordered.includes('milestones') ? (
                <ul className="about-timeline">
                  {about.milestones.map((entry, index) => (
                    <li className="about-timeline__item" key={`${entry.title}-${index}`}>
                      {entry.year ? <span className="about-timeline__year">{entry.year}</span> : null}
                      <span className="about-timeline__title">{entry.title}</span>
                      {entry.detail ? <span className="about-timeline__body">{entry.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div />
              )}

              {ordered.includes('credentials') ? (
                <ul className="about-timeline">
                  {about.credentials.map((entry, index) => (
                    <li className="about-timeline__item" key={`${entry.title}-${index}`}>
                      {entry.year ? <span className="about-timeline__year">{entry.year}</span> : null}
                      <span className="about-timeline__title">{entry.title}</span>
                      {entry.detail ? <span className="about-timeline__body">{entry.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <div />
              )}
            </div>
          </section>
        ) : null}

        <section className="section section--tight" aria-labelledby="library-heading" data-reveal>
          <div className="split split--about">
            <div className="stack stack--lg">
              <SectionTitle index="06" eyebrow="Right now" title="The library so far" id="library-heading" />
              <p style={{ color: 'var(--text-muted)' }}>
                {playable.length > 0
                  ? `${playable.length} game${playable.length === 1 ? '' : 's'} you can play right now, with more in production.`
                  : 'Something fun is loading into this world. Check back soon!'}
              </p>
              <div className="cluster">
                <Link className="btn btn--primary btn--sm" to="/games">
                  Open the arcade
                  <IconArrowRight size={16} />
                </Link>
              </div>
            </div>

            <div className="panel" style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <p className="panel__title">How this site works</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)' }}>
                Every game here was made elsewhere and released on itch.io; each listing is managed through my own
                dashboard. Publishing one is a database change, not a deploy — the site you are reading never has to be
                rebuilt.
              </p>
              <ZigZag />
            </div>
          </div>
        </section>

        <section className="section section--tight" aria-labelledby="elsewhere-heading">
          <div className="split split--contact">
            <div className="stack stack--lg">
              <SectionTitle index="07" eyebrow="Elsewhere" title="Profiles & projects" id="elsewhere-heading" />

              {links.length > 0 ? (
                <ul className="social-list">
                  {links.map((link) => {
                    const Icon = iconFor(link.icon);
                    const external = /^https?:/i.test(link.url);
                    return (
                      <li key={`${link.label}-${link.url}`}>
                        <a
                          className="social-link"
                          href={link.url}
                          {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                        >
                          <Icon size={18} />
                          {link.label}
                          {external ? <IconExternal size={14} /> : null}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="callout callout--info">
                  <span className="callout__title">No links yet</span>
                  <span>
                    I would rather show nothing than link to accounts I do not have. Add real URLs under{' '}
                    <strong>Site content → Profiles and links</strong> in the dashboard and they appear here, in the footer
                    and on the contact page.
                  </span>
                </div>
              )}
            </div>

            <EmailCard heading="Get in touch" body="Questions about a game, or a project you think I should see." />
          </div>
        </section>
      </div>
    </div>
  );
}
