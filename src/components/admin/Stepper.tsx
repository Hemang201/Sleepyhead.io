import { Link } from 'react-router-dom';

/** The four steps of publishing a game, in the order they have to happen. */
export const STEPS = [
  { id: 'info', label: 'Info', hint: 'Title, description, genres' },
  { id: 'itch', label: 'Player', hint: 'Connect the itch.io game' },
  { id: 'artwork', label: 'Artwork', hint: 'Thumbnail, banner, screenshots' },
  { id: 'publish', label: 'Publish', hint: 'Preview and go live' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export function Stepper({
  current,
  gameId,
  complete,
}: {
  current: StepId;
  /** When set, each step links to the editor section for this game. */
  gameId?: string;
  complete?: Partial<Record<StepId, boolean>>;
}) {
  return (
    <ol className="stepper" aria-label="Publishing steps">
      {STEPS.map((step, index) => {
        const active = step.id === current;
        const done = complete?.[step.id];
        const content = (
          <>
            <span className="stepper__index" aria-hidden="true">
              {done ? '✓' : index + 1}
            </span>
            <span className="stepper__body">
              <span className="stepper__label">{step.label}</span>
              <span className="stepper__hint">{step.hint}</span>
            </span>
          </>
        );

        return (
          <li key={step.id} className={`stepper__item${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}>
            {gameId ? (
              <Link to={`/admin/games/${gameId}?step=${step.id}`} aria-current={active ? 'step' : undefined}>
                {content}
              </Link>
            ) : (
              <span aria-current={active ? 'step' : undefined}>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
