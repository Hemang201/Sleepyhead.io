import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { site } from '../data/site';
import { useCatalogue } from '../lib/catalogue';
import { searchSite, type SearchResult } from '../lib/search';
import { highlightParts, queryTerms } from '../lib/games-query';
import { useBodyScrollLock, useFocusTrap } from '../lib/hooks';
import { track } from '../lib/analytics';
import { GameThumb } from './GameThumb';
import { IconArrowRight, IconClose, IconController, IconLayers, IconSearch } from './Icons';

interface SearchContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

const SearchContext = createContext<SearchContextValue | null>(null);

export function useSearchOverlay(): SearchContextValue {
  const context = useContext(SearchContext);
  if (!context) throw new Error('useSearchOverlay must be used inside <SearchProvider>');
  return context;
}

export function SearchProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    if (!site.features.search) return;
    setIsOpen(true);
    track('search_opened');
  }, []);
  const close = useCallback(() => setIsOpen(false), []);

  // Ctrl/Cmd+K (and "/") open search from anywhere on the site.
  useEffect(() => {
    if (!site.features.search) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setIsOpen((current) => !current);
        return;
      }
      if (event.key === '/' && !typing) {
        event.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const value = useMemo(() => ({ isOpen, open, close }), [close, isOpen, open]);

  return (
    <SearchContext.Provider value={value}>
      {children}
      {isOpen ? <SearchOverlay onClose={close} /> : null}
    </SearchContext.Provider>
  );
}

const GROUP_LABELS: Record<SearchResult['type'], string> = {
  game: 'Games',
  page: 'Pages',
};

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  const parts = highlightParts(text, terms);
  return (
    <>
      {parts.map((part, index) =>
        part.match ? (
          <mark className="hl" key={index}>
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { games } = useCatalogue();

  useFocusTrap(panelRef, true);
  useBodyScrollLock(true);

  const terms = useMemo(() => queryTerms(query), [query]);
  const results = useMemo(() => searchSite(games, query), [games, query]);

  const groups = useMemo(() => {
    const order: SearchResult['type'][] = ['game', 'page'];
    return order
      .map((type) => ({ type, items: results.filter((result) => result.type === type) }))
      .filter((group) => group.items.length > 0);
  }, [results]);

  const flat = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => setActiveIndex(0), [query]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  const go = useCallback(
    (to: string) => {
      track('search_used', { query });
      onClose();
      navigate(to);
    },
    [navigate, onClose, query],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (flat.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % flat.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + flat.length) % flat.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(flat[activeIndex]?.to ?? '/games');
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(flat.length - 1);
    }
  };

  return (
    <div className="search-overlay" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        className="search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search the site"
        ref={panelRef}
        onKeyDown={onKeyDown}
      >
        <div className="search-panel__head">
          <IconSearch size={22} />
          <label className="visually-hidden" htmlFor="hg-site-search">
            Search games, genres and pages
          </label>
          <input
            id="hg-site-search"
            data-autofocus
            className="search-panel__input"
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="hg-search-results"
            aria-activedescendant={flat[activeIndex] ? `hg-search-option-${flat[activeIndex].id}` : undefined}
            autoComplete="off"
            placeholder="Search games, genres, pages…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" className="icon-button icon-button--ghost" onClick={onClose} aria-label="Close search">
            <IconClose size={20} />
          </button>
        </div>

        <div className="search-panel__body">
          <ul className="search-results" id="hg-search-results" role="listbox" aria-label="Search results" ref={listRef}>
            {groups.map((group) => (
              <li key={group.type}>
                <p className="search-group__label" aria-hidden="true">
                  {GROUP_LABELS[group.type]} · {group.items.length}
                </p>
                <ul className="search-results">
                  {group.items.map((result) => {
                    const index = flat.findIndex((item) => item.id === result.id);
                    const active = index === activeIndex;
                    return (
                      <li key={result.id} role="option" aria-selected={active} id={`hg-search-option-${result.id}`}>
                        <Link
                          className="search-result"
                          data-active={active}
                          to={result.to}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={(event) => {
                            event.preventDefault();
                            go(result.to);
                          }}
                        >
                          {result.thumbnail ? (
                            <GameThumb
                              className="search-result__thumb"
                              src={result.thumbnail}
                              alt=""
                              width={144}
                              height={92}
                            />
                          ) : (
                            <span className="search-result__thumb search-result__thumb--icon" aria-hidden="true">
                              {result.type === 'game' ? <IconController size={22} /> : <IconLayers size={22} />}
                            </span>
                          )}
                          <span className="search-result__text">
                            <span className="search-result__title">
                              <Highlighted text={result.title} terms={terms} />
                            </span>
                            <span className="search-result__desc">
                              <Highlighted text={result.description} terms={terms} />
                            </span>
                            <span className="search-result__meta">
                              <Highlighted text={result.meta} terms={terms} />
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>

          {results.length === 0 ? (
            <div className="page-state" style={{ margin: 'var(--space-3)' }}>
              <h2 className="page-state__title">Nothing found for “{query}”</h2>
              <p className="page-state__body">
                Search looks at game titles, descriptions, genres and tags. Try a genre like <em>puzzle</em> or{' '}
                <em>physics</em>, or browse the whole library.
              </p>
              <div className="section__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={() => setQuery('')}>
                  Clear search
                </button>
                <button type="button" className="btn btn--primary btn--sm" onClick={() => go('/games')}>
                  <IconArrowRight size={16} />
                  Browse all games
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="search-panel__foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> to move
          </span>
          <span>
            <kbd>Enter</kbd> to open
          </span>
          <span>
            <kbd>Esc</kbd> to close
          </span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd>Ctrl</kbd>+<kbd>K</kbd> anywhere
          </span>
        </div>
      </div>
    </div>
  );
}
