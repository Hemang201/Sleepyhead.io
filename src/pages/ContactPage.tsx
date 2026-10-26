import { Link } from 'react-router-dom';
import { site } from '../data/site';
import { enabledSocialLinks } from '../shared/site-content';
import { useCatalogue } from '../lib/catalogue';
import { useSiteContent } from '../lib/site-content';
import { playableGames } from '../lib/library';
import { EmailCard } from '../components/EmailCard';
import { Seo } from '../components/Seo';
import { SOCIAL_ICONS, IconExternal, IconMail } from '../components/Icons';

/**
 * Everything above the fold here comes from the `contact` content document: the
 * owner edits the heading, the introduction, the public address and the reasons
 * in the dashboard, and this page follows without a rebuild.
 *
 * The address shown is the *public* one. The owner's private authentication
 * address lives in a different table and is never rendered on any public page.
 */
export default function ContactPage() {
  const { contact, social } = useSiteContent();
  const socials = enabledSocialLinks(social);
  const reasons = contact.reasons.length > 0 ? contact.reasons : site.contact.reasons;

  return (
    /* Magenta and violet: the warmest band on the site, which is what a "say
       hello" page should feel like. */
    <div className="page scheme--contact">
      <Seo
        title={`Contact ${site.developerName} — feedback, collaboration, enquiries`}
        description="Email me about game feedback, collaboration, technical discussions or project enquiries. One address, no forms, no mailing list."
        path="/contact"
      />

      <div className="container deco-host">
        <nav aria-label="Breadcrumb">
          <ol className="breadcrumbs">
            <li>
              <Link to="/">Home</Link>
            </li>
            <li aria-current="page">Contact</li>
          </ol>
        </nav>

        <div className="detail-hero__rail">
          <span className="stamp stamp--ink" aria-hidden="true">
            Contact
          </span>
          <span className="stamp stamp--ghost">One address, no forms</span>
          <span className="rail__sep" aria-hidden="true" />
        </div>

        <header className="stack" style={{ marginBottom: 'var(--space-6)', maxWidth: '72ch' }} data-reveal>
          <p className="section__eyebrow">
            <IconMail size={16} /> Say hello
          </p>
          <h1 className="section__title">{contact.heading || 'Let’s connect.'}</h1>
          <p className="section__lead">{contact.intro || site.contact.intro}</p>
        </header>

        {/* Public wording only: a visitor does not need, or want, to know
            which switch inside the dashboard produced this state. */}
        {!contact.visible ? (
          <div className="callout callout--info" style={{ marginBottom: 'var(--space-6)' }}>
            <span className="callout__title">Contact is closed at the moment</span>
            <span>
              The inbox is not open right now. The games and the rest of the site are unaffected, and this page will say
              so again as soon as it reopens.
            </span>
          </div>
        ) : null}

        <div className="split split--contact">
          <section aria-labelledby="reasons-heading">
            <h2 className="panel__title" id="reasons-heading">
              Good reasons to write
            </h2>
            <ul className="reason-list" style={{ marginTop: 'var(--space-4)' }}>
              {reasons.map((reason, index) => (
                <li className="reason" key={reason.title}>
                  <span className="reason__index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span className="reason__title">{reason.title}</span>
                  <span className="reason__body">{reason.body}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="stack stack--lg">
            {contact.visible ? <EmailCard /> : null}

            <div className="panel">
              <h2 className="panel__title">A note on forms</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)', marginTop: 'var(--space-2)' }}>
                There is no contact form on this site on purpose. A form with nowhere to send its messages is worse than
                no form at all — a <span className="kbd">mailto:</span> link always works, and you can see exactly where
                your message goes.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)', marginTop: 'var(--space-3)' }}>
                {contact.responseNote || site.contact.responseNote}
              </p>
            </div>

            <div className="panel">
              <h2 className="panel__title">Profiles</h2>
              {socials.length > 0 ? (
                <ul className="social-list" style={{ marginTop: 'var(--space-3)' }}>
                  {socials.map((link) => {
                    const Icon = SOCIAL_ICONS[link.platform] ?? IconExternal;
                    const external = /^https:/i.test(link.url);
                    return (
                      <li key={link.url}>
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
                /* A discreet fallback, deliberately: nothing here explains how the
                   site is run or where a profile would be configured. */
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)', marginTop: 'var(--space-2)' }}>
                  Email is the one route I always answer.
                </p>
              )}
            </div>

            <div className="panel" style={{ borderStyle: 'dashed' }}>
              <h2 className="panel__title">Report a broken game</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)' }}>
                {playableGames(useCatalogue().games).length > 0
                  ? 'If a game will not start, tell me which game and which browser — that is usually enough to find it.'
                  : 'Once games are live, this is the place to report one that will not start.'}
              </p>
              <Link className="btn btn--ghost btn--sm" to="/games">
                See what is playable
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
