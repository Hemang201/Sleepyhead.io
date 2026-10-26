import { SOCIAL_PLATFORMS, enabledSocialLinks, type SocialContent, type SocialPlatform } from '../shared/site-content';
import { useSiteContent } from '../lib/site-content';
import { SOCIAL_ICONS, IconArrowRight, IconSparkle } from './Icons';

/**
 * The social section at the bottom of the public site.
 *
 * The source of truth is the published `social` document from the Worker, so the
 * owner can add, reorder, disable or remove a link in the dashboard and the next
 * page load shows it — no rebuild, no redeploy.
 *
 * What is rendered is deliberately strict: only enabled links that survived URL
 * normalisation, in the saved order. With nothing configured the whole section
 * disappears rather than showing an empty row, a placeholder profile or an
 * invitation to visit the dashboard. `preview` is the one exception: the
 * dashboard renders the same component with draft content and an empty-state
 * note, which is the only place that note belongs.
 *
 * Everything here is a plain `<a>`: no click handlers, no new tab tricks. External
 * profiles open in a new tab with `noopener noreferrer`, and the fact that they
 * do is announced to assistive technology instead of being implied by an icon.
 */
export interface SocialSectionProps {
  /** Draft content, used by the dashboard preview instead of the published copy. */
  content?: SocialContent;
  /** Renders the section even when it has no links, with a quiet note. */
  preview?: boolean;
}

/** The short form of the platform name, for the mono tag on each card. */
function platformTag(platform: SocialPlatform): string {
  if (platform === 'website') return 'Link';
  if (platform === 'devto') return 'DEV';
  return SOCIAL_PLATFORMS[platform];
}

export function SocialSection({ content, preview = false }: SocialSectionProps = {}) {
  const { social } = useSiteContent();
  const document = content ?? social;
  const links = enabledSocialLinks(document);

  if (links.length === 0 && !preview) return null;

  return (
    <section
      className="social-band scheme--contact"
      aria-labelledby="social-heading"
      data-social-band
      data-social-count={links.length}
    >
      <div className="container social-band__inner">
        <header className="social-band__head">
          <p className="section__eyebrow">
            <IconSparkle size={16} />
            Elsewhere
          </p>
          <h2 className="social-band__title" id="social-heading">
            {document.heading || 'Find me on the internet'}
          </h2>
          {document.intro ? <p className="social-band__intro">{document.intro}</p> : null}
        </header>

        <div className="social-band__aside">
          <span className="stamp stamp--ink">
            {links.length} {links.length === 1 ? 'profile' : 'profiles'}
          </span>
          <span className="stamp stamp--ghost">Opens off-site</span>
        </div>

        {links.length > 0 ? (
          <ul className="social-band__grid">
            {links.map((link, index) => {
              const Icon = SOCIAL_ICONS[link.platform] ?? IconArrowRight;
              const external = /^https:/i.test(link.url);
              return (
                <li key={`${link.platform}-${link.url}`}>
                  <a
                    className="social-card"
                    href={link.url}
                    {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                    data-social-link={link.platform}
                  >
                    <span className="social-card__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="social-card__icon" aria-hidden="true">
                      <Icon size={22} />
                    </span>
                    <span className="social-card__body">
                      <span className="social-card__platform">{platformTag(link.platform)}</span>
                      <span className="social-card__name">
                        {link.label}
                        {external ? (
                          <span className="social-card__arrow" aria-hidden="true">
                            <IconArrowRight size={16} />
                          </span>
                        ) : null}
                      </span>
                      {link.handle ? <span className="social-card__handle">@{link.handle}</span> : null}
                      {link.description ? <span className="social-card__note">{link.description}</span> : null}
                      {external ? <span className="visually-hidden"> (opens in a new tab)</span> : null}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="social-band__empty">
            No links published yet. This section stays hidden on the public site until one is added and published.
          </p>
        )}
      </div>
    </section>
  );
}
