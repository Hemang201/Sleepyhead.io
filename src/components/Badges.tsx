import { Link } from 'react-router-dom';
import { CATEGORIES, STATUS_META, type CategoryId, type GameStatus } from '../shared/catalogue';

const ACCENT_VARS: Record<string, string> = {
  cyan: 'var(--neon-cyan)',
  violet: 'var(--neon-violet)',
  pink: 'var(--neon-pink)',
  lime: 'var(--neon-lime)',
  orange: 'var(--neon-orange)',
  blue: 'var(--neon-blue)',
};

export function accentColor(accent: string): string {
  return ACCENT_VARS[accent] ?? 'var(--accent)';
}

export function StatusBadge({
  status,
  className,
  label,
}: {
  status: GameStatus;
  className?: string;
  label?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <span className={`badge badge--${meta.tone} ${className ?? ''}`.trim()}>
      <span className="badge__dot" aria-hidden="true" />
      {label ?? meta.label}
    </span>
  );
}

/**
 * Shown while a game still uses the generated placeholder artwork, so the design
 * never pretends concept art is a real screenshot.
 */
export function PlaceholderBadge({ label = 'Placeholder art' }: { label?: string }) {
  return <span className="badge badge--placeholder">{label}</span>;
}

export function CategoryChips({
  categories,
  linkTo,
  className,
}: {
  categories: CategoryId[];
  /** When set, each chip becomes a link to the filtered library. */
  linkTo?: (category: CategoryId) => string;
  className?: string;
}) {
  return (
    <ul className={`tag-list ${className ?? ''}`.trim()}>
      {categories.map((category) => {
        const meta = CATEGORIES.find((entry) => entry.id === category);
        const label = meta?.label ?? category;
        const style = { ['--chip-accent' as string]: accentColor(meta?.accent ?? 'cyan') };
        return (
          <li key={category}>
            {linkTo ? (
              <Link className="chip chip--accent" style={style} to={linkTo(category)}>
                {label}
              </Link>
            ) : (
              <span className="chip chip--accent" style={style}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <ul className={`tag-list ${className ?? ''}`.trim()}>
      {tags.map((tag) => (
        <li key={tag}>
          <span className="chip chip--tag">#{tag}</span>
        </li>
      ))}
    </ul>
  );
}
