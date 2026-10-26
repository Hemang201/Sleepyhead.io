import { track } from '../lib/analytics';
import { useTheme } from './ThemeProvider';
import { IconMoon, IconSun } from './Icons';
import { THEMES, THEME_LABELS, type Theme } from '../lib/theme';

interface ThemeToggleProps {
  className?: string;
  /** "icon" in the header, "wide" inside menus where a label helps. */
  variant?: 'icon' | 'wide';
}

const GLYPHS: Record<Theme, (props: { size?: number }) => React.ReactElement> = {
  light: IconSun,
  dark: IconMoon,
};

/**
 * The theme control.
 *
 * The two themes are selectable rather than cycled, so the choice is one click.
 * Each option is a real button with
 * `aria-pressed`, grouped and labelled for keyboard and screen reader, with the
 * tooltip naming the mode the button switches to.
 */
export function ThemeToggle({ className, variant = 'icon' }: ThemeToggleProps) {
  const { theme, set } = useTheme();

  const choose = (next: Theme) => {
    set(next);
    track('theme_changed', { theme: next });
  };

  if (variant === 'wide') {
    return (
      <div className={`theme-pill theme-pill--wide ${className ?? ''}`.trim()} role="group" aria-label="Colour theme">
        {THEMES.map((entry) => {
          const Glyph = GLYPHS[entry];
          const active = theme === entry;
          return (
            <button
              key={entry}
              type="button"
              className="theme-pill__half theme-pill__half--wide"
              data-active={active}
              aria-pressed={active}
              aria-label={`${THEME_LABELS[entry]} theme`}
              title={`${THEME_LABELS[entry]} mode`}
              onClick={() => choose(entry)}
            >
              <Glyph size={16} />
              {THEME_LABELS[entry]}
            </button>
          );
        })}
      </div>
    );
  }

  /* Both glyphs are always visible; the current one is the one set in ink on
     the raised surface. That makes the control state readable at a glance
     rather than only through its label. */
  return (
    <div
      className={`theme-pill ${className ?? ''}`.trim()}
      role="group"
      aria-label="Colour theme"
      data-theme-state={theme}
    >
      {THEMES.map((entry) => {
        const Glyph = GLYPHS[entry];
        const active = theme === entry;
        return (
          <button
            key={entry}
            type="button"
            className="theme-pill__half"
            data-active={active}
            aria-pressed={active}
            aria-label={`${THEME_LABELS[entry]} theme`}
            title={`${THEME_LABELS[entry]} mode`}
            onClick={() => choose(entry)}
          >
            <Glyph size={16} />
          </button>
        );
      })}
    </div>
  );
}
