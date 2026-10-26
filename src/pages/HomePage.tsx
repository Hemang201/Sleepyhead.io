import { Link } from 'react-router-dom';

import { site } from '../data/site';
import { enabledSocialLinks, SOCIAL_PLATFORMS } from '../shared/site-content';
import { useCatalogue } from '../lib/catalogue';
import { useSiteContent } from '../lib/site-content';
import { favouriteGames, playableGames, recentlyPlayed, spotlightGames } from '../lib/library';
import { useStore } from '../lib/hooks';
import { favouritesStore, recentStore } from '../lib/preferences';
import { ArcadeBlueprint, ControllerArt, FrameMarks, ScrollCue } from '../components/Decorations';
import { TypewriterHeadline } from '../components/TypewriterHeadline';
import { WordRibbon } from '../components/WordRibbon';
import { EmailCard } from '../components/EmailCard';
import { GameCard } from '../components/GameCard';
import { GameThumb } from '../components/GameThumb';
import { Seo } from '../components/Seo';
import { ArcadeEmptyState, ErrorState, GameCardSkeleton } from '../components/States';
import {
  IconArrowDown,
  IconArrowRight,
  IconClock,
  IconController,
  IconExternal,
  IconHeart,
  IconPlay,
  IconSparkle,
  SOCIAL_ICONS,
} from '../components/Icons';

/**
 * Splits the hero statement into its two lines at the sentence boundary.
 *
 * The wording lives in `src/data/site.ts` as one string — the phrase is fixed
 * and its punctuation matters — so the split happens here rather than being
 * hard-coded twice in the markup. A headline with no full stop simply keeps one
 * line.
 */
function headlineLines(headline: string): string[] {
  const sentences = headline.split('. ').filter((part) => part.trim().length > 0);
  if (sentences.length <= 1) return [headline];
  return sentences.map((part, index) => (index === sentences.length - 1 ? part : `${part}.`));
}

const FEATURES = [
  {
    title: 'Instant play',
    body: 'No installer, no launcher, no account. Press play and the game loads from itch.io in the tab.',
    icon: <IconSparkle size={22} />,
  },
  {
    title: 'Browser based',
    body: 'Exports from Unity, Godot, GameMaker or hand-written canvas code all run the same way here.',
    icon: <IconController size={22} />,
  },
  {
    title: 'Made with curiosity',
    body: 'Every game starts as an experiment in game feel. The ones that survive the ugly prototype get finished.',
    icon: <IconClock size={22} />,
  },
];

export default function HomePage() {
  const { games, status, error, reload } = useCatalogue();
  const { social } = useSiteContent();

  useStore(favouritesStore);
  useStore(recentStore);

  const featured = spotlightGames(games, 5);
  const [lead, ...supporting] = featured;
  const socialLinks = enabledSocialLinks(social).slice(0, 6);
  const playableCount = playableGames(games).length;
  const favourites = site.features.favourites ? favouriteGames(games, favouritesStore.get()) : [];
  const recent = site.features.recentlyPlayed ? recentlyPlayed(games, recentStore.get(), 4) : [];
  const hasCatalogue = games.length > 0;

  return (
    <div className="page">
      <Seo
        title={`${site.developerName} — Indie Game Developer & Browser Arcade`}
        description={site.siteDescription}
        path="/"
        image="/art/social-card.svg"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Person',
          name: site.developerName,
          description: site.siteDescription,
          jobTitle: 'Independent game developer',
        }}
      />

      {/* --------------------------------------------------------------- hero */}
      <section
        className="container hero deco-host scheme--hero"
        aria-labelledby="hero-heading"
      >
        {/* A printed running head in the left margin, like the spine of a book.
            Decorative only: the page number is not information. */}
        <span className="hero__spine" aria-hidden="true">
          <span>01</span>
          <span className="hero__spine-words">
            Play · Create · Repeat
          </span>
        </span>

        <div className="hero__spotlight">
          {/* ------------------------------------------------ the statement */}
          <div className="hero__lead">
            <p className="hero__eyebrow">{site.hero.eyebrow}</p>

            <p className="hero__subhead">{site.hero.subheadline}</p>

            {/* The wording and its punctuation come from the site data: the
                first sentence lands in ink, the second in the display gradient,
                and the whole phrase types itself on. */}
            <TypewriterHeadline lines={headlineLines(site.hero.headline)} />

            <p className="hero__paragraph">{site.hero.paragraph}</p>

            <div className="hero__actions">
              <Link className="btn btn--primary btn--lg" to={site.hero.primaryCta.to}>
                {site.hero.primaryCta.label}
                <IconArrowRight size={18} />
              </Link>
              <Link className="btn btn--secondary btn--lg" to={site.hero.secondaryCta.to}>
                {site.hero.secondaryCta.label}
              </Link>
            </div>

            <p className="hero__labels">{site.hero.labels.join(' · ')}</p>
          </div>

          {/* --------------------------------------------- the framed artwork */}
          <figure className="hero__frame">
            <FrameMarks />
            <span className="hero__frame-block hero__frame-block--a" aria-hidden="true" />
            <span className="hero__frame-block hero__frame-block--b" aria-hidden="true" />
            <span className="hero__frame-block hero__frame-block--c" aria-hidden="true" />
            <span className={`hero__frame-art${lead ? '' : ' hero__frame-art--empty'}`}>
              {lead ? (
                <GameThumb
                  src={lead.artwork.banner ?? lead.artwork.thumbnail}
                  alt={`Artwork from ${lead.title}`}
                  priority
                  width={800}
                  height={1000}
                />
              ) : (
                <ArcadeBlueprint />
              )}
            </span>
            <figcaption className="hero__note">
              Small games.
              <br />
              <em>Big ideas.</em>
              <IconArrowDown size={22} />
            </figcaption>
          </figure>

          {/* ------------------------------ the featured game and this site */}
          <aside className="hero__aside">
            {lead ? (
              <article className="spotlight-card">
                <span className="spotlight-card__tag">Featured</span>
                <p className="spotlight-card__label">Featured game</p>
                <div className="spotlight-card__head">
                  <div>
                    <h2 className="spotlight-card__title">{lead.title}</h2>
                    <ul className="spotlight-card__chips">
                      {lead.categories.slice(0, 3).map((category) => (
                        <li key={category}>
                          <span className="chip chip--accent">{category}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <span className="spotlight-card__art">
                    <GameThumb src={lead.artwork.thumbnail} alt={`Cover art for ${lead.title}`} priority width={400} height={300} />
                  </span>
                </div>
                <p className="spotlight-card__body">{lead.shortDescription}</p>
                <div className="spotlight-card__actions">
                  {lead.playable ? (
                    <Link className="btn btn--primary btn--sm" to={`${lead.path}#play`}>
                      <IconPlay size={15} />
                      Play now
                    </Link>
                  ) : (
                    <Link className="btn btn--secondary btn--sm" to={lead.path}>
                      Take a look
                    </Link>
                  )}
                  <Link className="btn btn--ghost btn--sm" to={lead.path} aria-label={`Open ${lead.title}`}>
                    <IconExternal size={15} />
                  </Link>
                </div>
              </article>
            ) : (
              /* No published game yet: an honest status card keeps the right
                 column grounded instead of leaving a hole beside the hero. */
              <article className="bench-card">
                <div className="bench-card__head">
                  <p className="spotlight-card__label">Featured game</p>
                  {/* A cabinet drawn in the same monoline as the hero artwork:
                      a mark, not a screenshot. Nothing here pretends to be a
                      game that does not exist. */}
                  <span className="bench-card__mark" aria-hidden="true">
                    <svg viewBox="0 0 64 64" width="52" height="52" fill="none" focusable="false">
                      <rect x="9" y="13" width="46" height="40" rx="4" stroke="currentColor" strokeWidth="2" />
                      <rect x="17" y="21" width="30" height="16" rx="2" stroke="var(--ink-soft)" strokeWidth="1.6" />
                      <path d="M22 47h9M43 44v6M40 47h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="52" cy="10" r="3" fill="var(--paper-lavender)" />
                    </svg>
                  </span>
                </div>
                <h2 className="bench-card__title">First game in progress.</h2>
                <p className="bench-card__body">
                  A small browser game is on its way. It will appear here the moment it is published.
                </p>
                <p className="bench-card__status">
                  <span className="bench-card__dot" aria-hidden="true" />
                  In development
                </p>
              </article>
            )}

            <div className="site-note">
              <h2 className="site-note__title">About this site</h2>
              <p className="site-note__body">
                A collection of small, creative games built for the web. Each one is a real experiment — simple to
                play, fun to explore, and always free.
              </p>
              <Link className="site-note__link" to="/about">
                Learn more
                <IconArrowRight size={15} />
              </Link>

              {socialLinks.length > 0 ? (
                <>
                  <hr className="site-note__rule" />
                  <p className="spotlight-card__label">Socials</p>
                  <ul className="site-note__socials">
                    {socialLinks.map((link) => {
                      const Glyph = SOCIAL_ICONS[link.platform];
                      return (
                        <li key={link.url}>
                          <a
                            className="social-dot"
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${link.label || SOCIAL_PLATFORMS[link.platform]} (opens in a new tab)`}
                          >
                            <Glyph size={16} />
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </div>
          </aside>
        </div>

        {/* The foot of the band: a stamped signature, the playable count, and
            the cue into the featured games. */}
        <div className="hero__foot">
          <span className="hero__stamp">Built with passion</span>
          <span className="hero__stamp hero__stamp--count">
            {playableCount > 0 ? `${playableCount} playable now` : 'First games in progress'}
          </span>
          <a className="hero__scroll-cue" href="#featured-games">
            <ScrollCue label="Scroll" />
          </a>
        </div>
      </section>

      {/* --------------------------------------------------- the word ribbon */}
      {/* The signature graphic: game-development words travelling along a curve.
          It is a band of its own rather than a layer behind the hero, because
          the hero already has a headline, an illustration and a call to action
          competing for the same space — and a moving ribbon over live text is
          how a good idea becomes a readability bug. */}
      <div className="ribbon-band">
        <WordRibbon />
      </div>

      {/* ---------------------------------------------------- recently played */}
      {recent.length > 0 ? (
        <section className="container section section--tight" aria-labelledby="recent-heading">
          <h2 className="eyebrow" id="recent-heading">
            <IconClock size={16} />
            Pick up where you left off
          </h2>
          <ul className="recent-strip" style={{ marginTop: 'var(--space-3)' }}>
            {recent.map(({ game, at }) => (
              <li key={game.slug}>
                <Link className="recent-chip" to={game.path}>
                  <IconController size={16} />
                  {game.title}
                  <span className="visually-hidden">, played recently</span>
                  <span aria-hidden="true" style={{ color: 'var(--text-dim)', fontSize: 'var(--step--2)' }}>
                    {new Date(at).toLocaleDateString()}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* -------------------------------------------------------- favourites */}
      {favourites.length > 0 ? (
        <section className="container section section--tight" aria-labelledby="favourites-heading">
          <h2 className="eyebrow" id="favourites-heading">
            <IconHeart size={16} filled />
            Your favourites
          </h2>
          <ul className="recent-strip" style={{ marginTop: 'var(--space-3)' }}>
            {favourites.map((game) => (
              <li key={game.slug}>
                <Link className="recent-chip" to={game.path}>
                  <IconHeart size={14} filled />
                  {game.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ---------------------------------------------------- featured games */}
      <section
        className="container section scheme--arcade"
        id="featured-games"
        aria-labelledby="featured-heading"
      >
        {/* A numbered head like every other band, so the homepage reads
            01 → 02 → 03 → 04 instead of starting at 03. The drawn arrow stays
            as the eyebrow's mark: it is the one flourish on the page that
            points at the content. */}
        <header className="sec-head" data-reveal>
          <span className="sec-head__index" aria-hidden="true">
            01
          </span>
          <div className="sec-head__body">
            <p className="section__eyebrow">
              <span className="sec-head__flourish" aria-hidden="true">
                <svg viewBox="0 0 44 28" width="40" height="26" fill="none" aria-hidden="true">
                  <path d="M2 24C9 10 20 4 34 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                  <path
                    d="M28 2.5 35 6l-5 6"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              The arcade
            </p>
            <h2 className="section__title" id="featured-heading">
              Featured games
            </h2>
          </div>
          {games.length > 0 ? (
            <div className="sec-head__aside">
              <Link className="btn btn--ghost btn--sm" to="/games">
                View all games
                <IconArrowRight size={16} />
              </Link>
            </div>
          ) : null}
        </header>

        {status === 'loading' ? <GameCardSkeleton count={3} /> : null}

        {status === 'error' && !hasCatalogue ? (
          <ErrorState
            title="The arcade could not load"
            body={<p>{error ?? 'The catalogue is unavailable right now.'}</p>}
            onRetry={reload}
          />
        ) : null}

        {status !== 'loading' && status !== 'error' ? (
          games.length === 0 ? (
            /* Full band width: a 56rem note floating in a 1440px band left half
               the page as unexplained white space. */
            <ArcadeEmptyState className="arcade-empty--wide" />
          ) : (
            /* One banner entry point (artwork behind the copy) and a 2x2 field
               of compact rows beside it — the reference composition. */
            <div className="spotlight" data-reveal-group>
              {lead ? <GameCard game={lead} priority variant="banner" flag="Featured" /> : null}
              {supporting.length > 0 ? (
                <div className="spotlight__grid">
                  {supporting.map((game) => (
                    <GameCard key={game.slug} game={game} priority variant="row" />
                  ))}
                </div>
              ) : null}
            </div>
          )
        ) : null}
      </section>

      {/* ------------------------------------------------------ what to expect */}
      <section
        className="container section section--tight scheme--studio"
        aria-labelledby="expect-heading"
      >
        <header className="sec-head" data-reveal>
          <span className="sec-head__index" aria-hidden="true">
            02
          </span>
          <div className="sec-head__body">
            <p className="section__eyebrow">How it works</p>
            <h2 className="section__title" id="expect-heading">
              What to expect
            </h2>
          </div>
        </header>
        <div className="feature-strip" data-reveal-group>
          {FEATURES.map((feature, index) => (
            <div className="feature-strip__item" key={feature.title}>
              <span className="feature-strip__index" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="page-state__icon" style={{ width: 44, height: 44 }} aria-hidden="true">
                {feature.icon}
              </span>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ about */}
      <section
        className="container section scheme--about"
        id="about"
        aria-labelledby="about-heading"
      >
        <header className="sec-head" data-reveal>
          <span className="sec-head__index" aria-hidden="true">
            03
          </span>
          <div className="sec-head__body">
            <p className="section__eyebrow">The developer</p>
            <h2 className="section__title" id="about-heading">
              Who am I?
            </h2>
          </div>
        </header>

        <div className="split split--about" data-reveal-group>
          <div className="stack stack--lg">
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step-1)' }}>{site.about.intro}</p>
            <p style={{ color: 'var(--text-muted)' }}>{site.about.body[0]}</p>
            <div>
              <span className="field__label">Things I work with</span>
              <ul className="about-tags" style={{ marginTop: 'var(--space-3)' }}>
                {site.about.skillTags.map((tag) => (
                  <li key={tag}>
                    <span className="chip">{tag}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="section__actions">
              <Link className="btn btn--secondary" to={site.about.cta.to}>
                {site.about.cta.label}
                <IconArrowRight size={18} />
              </Link>
            </div>
          </div>

          {/* A printed block: the one inverted-weight surface in this band. */}
          <div className="about-thesis">
            <span className="frame__corners" aria-hidden="true" />
            <ControllerArt />
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)', marginTop: 'var(--space-4)' }}>
              I build in short, honest cycles: prototype, play it far too many times, then throw most of it away. This
              page is the collection of the parts that survived.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- contact */}
      <section
        className="container section scheme--contact"
        id="contact"
        aria-labelledby="contact-heading"
      >
        <header className="sec-head" data-reveal>
          <span className="sec-head__index" aria-hidden="true">
            04
          </span>
          <div className="sec-head__body">
            <p className="section__eyebrow">Say hello</p>
            <h2 className="section__title" id="contact-heading">
              Let&rsquo;s connect.
            </h2>
            <p className="section__lead">{site.contact.intro}</p>
          </div>
        </header>

        <div className="split split--contact" data-reveal-group>
          <ul className="reason-list">
            {site.contact.reasons.slice(0, 4).map((reason, index) => (
              <li className="reason" key={reason.title}>
                <span className="reason__index" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="reason__title">{reason.title}</span>
                <span className="reason__body">{reason.body}</span>
              </li>
            ))}
          </ul>

          <div className="stack stack--lg">
            <EmailCard />
            <Link className="btn btn--ghost" to="/contact">
              More ways to get in touch
              <IconArrowRight size={18} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
