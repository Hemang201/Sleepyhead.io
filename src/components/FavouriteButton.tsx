import { site } from '../data/site';
import { favouritesStore, toggleFavourite } from '../lib/preferences';
import { useStore } from '../lib/hooks';
import { track } from '../lib/analytics';
import { IconHeart } from './Icons';

interface FavouriteButtonProps {
  slug: string;
  title: string;
  size?: 'sm' | 'md';
}

/**
 * Favourites are stored locally only — no account, no server, no personal data.
 * Hidden entirely when the feature is switched off in site.ts.
 */
export function FavouriteButton({ slug, title, size = 'md' }: FavouriteButtonProps) {
  const favourites = useStore(favouritesStore);
  if (!site.features.favourites) return null;

  const active = favourites.includes(slug);

  return (
    <button
      type="button"
      className={`icon-button icon-button--ghost${active ? ' is-active' : ''}`}
      style={size === 'sm' ? { width: 38, height: 38 } : undefined}
      aria-pressed={active}
      aria-label={active ? `Remove ${title} from favourites` : `Add ${title} to favourites`}
      title={active ? 'Remove from favourites' : 'Save to favourites'}
      onClick={() => {
        const added = toggleFavourite(slug);
        track('filter_changed', { action: added ? 'favourite_added' : 'favourite_removed', slug });
      }}
    >
      <IconHeart size={size === 'sm' ? 18 : 20} filled={active} />
    </button>
  );
}
