import { Link } from 'react-router-dom';
import { useCatalogue } from '../lib/catalogue';
import { featuredGames } from '../lib/library';
import { GameCard } from '../components/GameCard';
import { Seo } from '../components/Seo';
import { IconArrowRight, IconCompass } from '../components/Icons';

export default function NotFoundPage() {
  const { games } = useCatalogue();
  const suggestions = featuredGames(games, 3);

  return (
    <div className="page">
      <Seo
        title="Page not found | Hemang Gupta"
        description="That page does not exist. Browse the games library instead — every playable game lives there."
        path="/404"
        noIndex
      />

      <div className="container not-found deco-host">
        <p className="eyebrow">
          <IconCompass size={16} /> Lost in the arcade
        </p>
        <p className="not-found__code" aria-hidden="true">
          404
        </p>
        <h1 className="section__title">This page does not exist</h1>
        <p className="section__lead">
          The link may be old, mistyped, or pointing at something I have not built yet. {games.length} games are still
          waiting, and they are all reachable from the library.
        </p>
        <div className="section__actions">
          <Link className="btn btn--primary" to="/games">
            Browse all games
            <IconArrowRight size={18} />
          </Link>
          <Link className="btn btn--secondary" to="/">
            Back to the home page
          </Link>
        </div>
      </div>

      {suggestions.length > 0 ? (
        <section className="container section section--tight" aria-labelledby="suggestions-heading">
          <h2 className="section__title" id="suggestions-heading" style={{ fontSize: 'var(--step-2)' }}>
            While you are here
          </h2>
          <div className="grid grid--games" style={{ marginTop: 'var(--space-5)' }}>
            {suggestions.map((game) => (
              <GameCard key={game.slug} game={game} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
