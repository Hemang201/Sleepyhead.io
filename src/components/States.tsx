import type { ReactNode } from 'react';
import { IconAlert, IconController, IconSearch } from './Icons';

interface StateProps {
  title: string;
  body: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'error';
  live?: boolean;
}

export function PageState({ title, body, actions, icon, tone = 'neutral', live = false }: StateProps) {
  return (
    <div
      className={`page-state page-state--center${tone === 'error' ? ' page-state--error' : ''}`}
      role={tone === 'error' ? 'alert' : undefined}
      aria-live={live && tone !== 'error' ? 'polite' : undefined}
    >
      <span className="page-state__icon" aria-hidden="true">
        {icon ?? (tone === 'error' ? <IconAlert size={26} /> : <IconController size={26} />)}
      </span>
      <h2 className="page-state__title">{title}</h2>
      <div className="page-state__body">{body}</div>
      {actions ? <div className="section__actions">{actions}</div> : null}
    </div>
  );
}

/**
 * The honest empty arcade.
 *
 * Nothing has been published yet, so this deliberately shows no card, no
 * artwork and no play action — just a small drawn mark and a sentence. It is a
 * status message rather than a heading, so it can sit under any section title.
 */
export function ArcadeEmptyState({ className }: { className?: string }) {
  return (
    <div className={`arcade-empty${className ? ` ${className}` : ''}`} role="status">
      <svg
        className="arcade-empty__art"
        viewBox="0 0 168 120"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="1" y="1" width="166" height="118" stroke="var(--ink-faint)" strokeDasharray="4 6" />
        <rect x="22" y="22" width="124" height="76" stroke="var(--ink-soft)" strokeWidth="1.6" />
        <path d="M22 46h124" stroke="var(--ink-faint)" />
        <circle cx="36" cy="34" r="3" fill="var(--scheme-a)" />
        <circle cx="48" cy="34" r="3" fill="var(--scheme-c)" opacity="0.7" />
        <path d="M56 62h56" stroke="var(--ink-soft)" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M56 74h34" stroke="var(--ink-faint)" strokeWidth="1.4" strokeLinecap="round" />
        <rect x="56" y="84" width="26" height="7" fill="var(--scheme-b)" />
        <path d="M118 66l6 14 14 6-14 6-6 14-6-14-14-6 14-6 6-14Z" fill="var(--scheme-a)" opacity="0.85" />
        <path d="M150 20v12M144 26h12" stroke="var(--scheme-c)" strokeLinecap="round" />
      </svg>
      <div className="arcade-empty__copy">
        <p className="arcade-empty__eyebrow">In the workshop</p>
        <p className="arcade-empty__title">The arcade is getting ready.</p>
        <p className="arcade-empty__body">My first browser game is in development. Check back soon.</p>
      </div>
    </div>
  );
}

export function NoResultsState({ query, onReset }: { query: string; onReset?: () => void }) {
  return (
    <PageState
      live
      icon={<IconSearch size={26} />}
      title="No games match that search"
      body={
        <>
          <p>
            Nothing in the library matches <strong>{query}</strong>. Try a shorter word, or clear the filters to see
            everything that is on the way.
          </p>
        </>
      }
      actions={
        onReset ? (
          <button type="button" className="btn btn--secondary" onClick={onReset}>
            Reset filters
          </button>
        ) : null
      }
    />
  );
}

export function ErrorState({ title, body, onRetry }: { title: string; body: ReactNode; onRetry?: () => void }) {
  return (
    <PageState
      tone="error"
      title={title}
      body={body}
      actions={
        onRetry ? (
          <button type="button" className="btn btn--secondary" onClick={onRetry}>
            Try again
          </button>
        ) : null
      }
    />
  );
}

/** Skeleton placeholders for the same card footprint, so nothing jumps. */
export function GameCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="grid grid--games" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <div className="skeleton skeleton-card__media" />
          <div className="skeleton skeleton-card__line skeleton-card__line--title" />
          <div className="skeleton skeleton-card__line" />
          <div className="skeleton skeleton-card__line skeleton-card__line--short" />
        </div>
      ))}
    </div>
  );
}

export function LoadingAnnouncement({ label }: { label: string }) {
  return (
    <p className="visually-hidden" role="status">
      {label}
    </p>
  );
}
