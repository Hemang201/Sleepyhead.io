import type { ReactNode } from 'react';

import { IconArrowDown, IconArrowUp, IconClose, IconPlus } from '../Icons';

/**
 * A repeatable content field: add, edit, remove and reorder.
 *
 * Used for every list on the About editor (skills, interests, principles,
 * milestones, links). Reordering is done with buttons rather than drag and drop
 * so it works with a keyboard, a screen reader and a touch screen alike, and the
 * order the owner sets is the order the public page uses.
 */
export interface RepeatableProps<T> {
  label: string;
  hint?: string;
  items: T[];
  max: number;
  /** A new, empty item. */
  empty: () => T;
  onChange: (items: T[]) => void;
  render: (item: T, update: (patch: Partial<T>) => void, index: number) => ReactNode;
  /** Short heading for each card, e.g. the item's title. */
  heading: (item: T, index: number) => string;
  addLabel?: string;
  /** Optional per-item validation message. */
  errorFor?: (item: T, index: number) => string | null;
}

export function Repeatable<T>({
  label,
  hint,
  items,
  max,
  empty,
  onChange,
  render,
  heading,
  addLabel = 'Add item',
  errorFor,
}: RepeatableProps<T>) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  const update = (index: number, patch: Partial<T>) => {
    onChange(items.map((item, position) => (position === index ? { ...item, ...patch } : item)));
  };

  return (
    <section className="repeatable" aria-label={label}>
      <div className="repeatable__head">
        <div>
          <span className="field__label">{label}</span>
          {hint ? <p className="field__hint">{hint}</p> : null}
        </div>
        <span className="field__hint">
          {items.length}/{max}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="repeatable__empty">Nothing here yet. Optional content stays hidden on the public page until you add it.</p>
      ) : (
        <ul className="repeatable__list">
          {items.map((item, index) => {
            const problem = errorFor?.(item, index) ?? null;
            return (
              <li className="repeatable__item" key={index}>
                <div className="repeatable__item-head">
                  <span className="repeatable__item-title">{heading(item, index) || `Item ${index + 1}`}</span>
                  <div className="repeatable__item-actions">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      aria-label={`Move ${heading(item, index) || `item ${index + 1}`} up`}
                    >
                      <IconArrowUp size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => move(index, index + 1)}
                      disabled={index === items.length - 1}
                      aria-label={`Move ${heading(item, index) || `item ${index + 1}`} down`}
                    >
                      <IconArrowDown size={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      onClick={() => onChange(items.filter((_, position) => position !== index))}
                      aria-label={`Remove ${heading(item, index) || `item ${index + 1}`}`}
                    >
                      <IconClose size={14} />
                    </button>
                  </div>
                </div>

                <div className="repeatable__item-body">
                  {render(item, (patch) => update(index, patch), index)}
                  {problem ? <span className="field__error">{problem}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onChange([...items, empty()])}
        disabled={items.length >= max}
      >
        <IconPlus size={16} />
        {addLabel}
      </button>
    </section>
  );
}

/**
 * A simple list of short strings (skills, interests, current focus).
 *
 * Written separately from `Repeatable` because its items are plain strings, and
 * wrapping them in objects just to satisfy a generic would be worse for the
 * reader. The behaviour is identical: add, edit, remove, reorder.
 */
export function StringList({
  label,
  hint,
  items,
  max,
  maxLength,
  placeholder,
  addLabel = 'Add',
  onChange,
}: {
  label: string;
  hint?: string;
  items: string[];
  max: number;
  maxLength: number;
  placeholder?: string;
  addLabel?: string;
  onChange: (items: string[]) => void;
}) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <section className="repeatable" aria-label={label}>
      <div className="repeatable__head">
        <div>
          <span className="field__label">{label}</span>
          {hint ? <p className="field__hint">{hint}</p> : null}
        </div>
        <span className="field__hint">
          {items.length}/{max}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="repeatable__empty">Nothing here yet — empty lists stay hidden on the public page.</p>
      ) : (
        <ul className="repeatable__list">
          {items.map((item, index) => (
            <li className="repeatable__item repeatable__item--row" key={index}>
              <span className="repeatable__handle" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <input
                className="input"
                value={item}
                maxLength={maxLength + 20}
                placeholder={placeholder}
                aria-label={`${label} item ${index + 1}`}
                onChange={(event) => onChange(items.map((entry, position) => (position === index ? event.target.value : entry)))}
              />
              <div className="repeatable__item-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => move(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`Move item ${index + 1} up`}
                >
                  <IconArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => move(index, index + 1)}
                  disabled={index === items.length - 1}
                  aria-label={`Move item ${index + 1} down`}
                >
                  <IconArrowDown size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={() => onChange(items.filter((_, position) => position !== index))}
                  aria-label={`Remove item ${index + 1}`}
                >
                  <IconClose size={14} />
                </button>
              </div>
              {item.trim().length > maxLength ? (
                <span className="field__error">Keep it under {maxLength} characters.</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => onChange([...items, ''])}
        disabled={items.length >= max}
      >
        <IconPlus size={16} />
        {addLabel}
      </button>
    </section>
  );
}
