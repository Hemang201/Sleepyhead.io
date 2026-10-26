import { useId, useRef, type ReactNode } from 'react';

import { useBodyScrollLock, useEscapeKey, useFocusTrap } from '../../lib/hooks';

/**
 * Confirmation for anything that destroys or hides work. The dialog always
 * names the thing being acted on, so nobody deletes a game by muscle memory.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  /* Two dialogs can be mounted at once (artwork and screenshots), so the label
     ids must be unique or the second dialog would point at the first one's text. */
  const titleId = useId();
  const bodyId = useId();
  useFocusTrap(panelRef, open);
  useBodyScrollLock(open);
  useEscapeKey(onCancel, open);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="modal__title" id={titleId}>
          {title}
        </h2>
        <div className="modal__body" id={bodyId}>
          {body}
        </div>
        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`}
            onClick={onConfirm}
            disabled={busy}
            data-autofocus
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
