import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { emptyDraft, GameForm, type GameDraft } from '../../components/admin/GameForm';
import { Stepper } from '../../components/admin/Stepper';
import { useAdmin } from '../../lib/admin';

/**
 * Step A of publishing: the game's details and its itch.io addresses. Saving
 * creates a private draft and moves on to checking the embedded player. Nothing
 * is uploaded here — the game itself lives on itch.io, while its cover art and
 * screenshots are uploaded to this site in Step C.
 */
export default function AdminNewGamePage() {
  const navigate = useNavigate();
  const { notify } = useAdmin();
  const [draft] = useState<GameDraft>(() => emptyDraft());

  return (
    <div className="stack stack--lg admin-page">
      <header className="admin-page__head">
        <div>
          <p className="section__eyebrow">New game</p>
          <h1 className="section__title">Add a game</h1>
          <p className="section__lead">
            Publish the game on itch.io first, then connect it here. This site keeps the listing, the artwork and the
            player frame on your own domain — it never hosts or builds the game itself.
          </p>
        </div>
      </header>

      <Stepper current="info" />

      <GameForm
        initial={draft}
        mode="create"
        hasPlayer={false}
        hasArtwork={false}
        saveLabel="Create draft and continue"
        onCreated={(game) => {
          notify({
            tone: 'ok',
            title: 'Draft created',
            body: 'Next, check the itch.io player and add the cover art.',
          });
          navigate(`/admin/games/${game.id}?step=itch`);
        }}
      />
    </div>
  );
}
