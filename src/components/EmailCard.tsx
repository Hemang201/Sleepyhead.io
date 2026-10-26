import { isPlaceholderEmail } from '../data/site';
import { useCopyToClipboard } from '../lib/hooks';
import { useSiteContent } from '../lib/site-content';
import { track } from '../lib/analytics';
import { IconCheck, IconCopy, IconMail } from './Icons';

interface EmailCardProps {
  /** Shown above the address. */
  heading?: string;
  body?: string;
}

/**
 * The primary contact action.
 *
 * Uses a real mailto: link so it opens the visitor's own mail client — no form
 * that silently discards messages, and no invented address.
 *
 * The address comes from the *public contact* content the owner edits in the
 * dashboard, and it is deliberately unrelated
 * to the owner's private authentication address, which is never rendered here.
 * While no real address is configured the card says so instead of pretending.
 */
export function EmailCard({ heading = 'Email me directly', body, email }: EmailCardProps & { email?: string }) {
  const { copied, failed, copy } = useCopyToClipboard();
  const { contact } = useSiteContent();
  const address = (email ?? contact.email ?? '').trim();
  const placeholder = isPlaceholderEmail(address);

  return (
    <div className="email-card">
      <div className="stack stack--sm">
        <h3 className="panel__title">{heading}</h3>
        {body ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)' }}>{body}</p>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--step--1)' }}>
            One address, and it reaches me. No forms, no auto-replies.
          </p>
        )}
      </div>

      <p className="email-card__address">
        <IconMail size={18} />
        {placeholder ? 'Email is the best way to reach me.' : address}
      </p>

      {/* Only reachable if the address is cleared in the dashboard (or is
          mid-change): the card must never pretend a link works when it does
          not, and it must never read like an unfinished page. */}
      {placeholder ? (
        <p className="email-card__note">
          The address is momentarily offline. The profile links below are the quickest way through in the meantime.
        </p>
      ) : null}

      {!placeholder ? (
        <div className="email-card__actions">
          <a
            className="btn btn--primary"
            href={`mailto:${address}`}
            onClick={() => track('contact_email_copied', { action: 'mailto_opened' })}
          >
            <IconMail size={18} />
            Open in email app
          </a>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              copy(address);
              track('contact_email_copied', { action: 'copied' });
            }}
          >
            {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
        </div>
      ) : null}

      <p className="visually-hidden" role="status" aria-live="polite">
        {copied ? 'Email address copied to clipboard' : failed ? 'Could not copy automatically' : ''}
      </p>
      {failed ? (
        <p className="field__hint" role="status">
          Copying was blocked by the browser — select the address above and copy it manually.
        </p>
      ) : null}
    </div>
  );
}
