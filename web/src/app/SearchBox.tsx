import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { useSuggest } from "../api/queries";
import { paths } from "./paths";
import styles from "./SearchBox.module.css";

const listboxId = "anime-search-suggestions";

export function SearchBox() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimer = useRef<number | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const suggestionsQuery = useSuggest(query);
  const suggestions = suggestionsQuery.data?.items ?? [];
  const normalizedQuery = query.trim();
  const hasSuggestions = normalizedQuery.length >= 2;
  const activeIndex = active >= 0 && active < suggestions.length ? active : -1;
  const showPopover = open && hasSuggestions && !suggestionsQuery.isError;
  const showListbox =
    showPopover && !suggestionsQuery.isFetching && suggestions.length > 0;

  useEffect(() => {
    if (mobileOpen) {
      inputRef.current?.focus();
    }
  }, [mobileOpen]);

  useEffect(() => {
    return () => {
      if (blurTimer.current !== undefined) {
        window.clearTimeout(blurTimer.current);
      }
    };
  }, []);

  function clearBlurTimer() {
    if (blurTimer.current !== undefined) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = undefined;
    }
  }

  function closeSearch(clearQuery: boolean) {
    clearBlurTimer();
    setOpen(false);
    setMobileOpen(false);
    setActive(-1);
    if (clearQuery) {
      setQuery("");
    }
  }

  function openSuggestion(index: number) {
    const item = suggestions[index];
    if (!item) {
      return;
    }
    navigate(paths.anime(item.slug));
    closeSearch(true);
  }

  function submitSearch() {
    if (activeIndex >= 0) {
      openSuggestion(activeIndex);
      return;
    }
    if (normalizedQuery) {
      navigate(paths.search(normalizedQuery));
      closeSearch(true);
    }
  }

  function toggleMobileSearch() {
    setMobileOpen((current) => {
      if (current) {
        setOpen(false);
        setActive(-1);
      }
      return !current;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitSearch();
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setQuery(event.target.value);
    setOpen(true);
    setActive(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((current) =>
        current <= 0 ? suggestions.length - 1 : current - 1,
      );
    } else if (event.key === "Enter") {
      event.preventDefault();
      submitSearch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeSearch(true);
    }
  }

  function handleBlur() {
    clearBlurTimer();
    blurTimer.current = window.setTimeout(() => {
      setOpen(false);
      setActive(-1);
    }, 120);
  }

  function handleFocus() {
    clearBlurTimer();
    setOpen(true);
  }

  return (
    <div className={styles.searchArea}>
      <button
        className={styles.searchTrigger}
        type="button"
        aria-expanded={mobileOpen}
        aria-controls="mobile-anime-search"
        onClick={toggleMobileSearch}
      >
        Tìm
      </button>
      <div className={styles.searchRow} id="mobile-anime-search">
        <form className={styles.form} role="search" onSubmit={handleSubmit}>
          <label className="visually-hidden" htmlFor="site-search">
            Tìm anime
          </label>
          <input
            ref={inputRef}
            id="site-search"
            role="combobox"
            type="search"
            value={query}
            placeholder="Tìm anime"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={showListbox ? listboxId : undefined}
            aria-expanded={showPopover}
            aria-activedescendant={
              activeIndex >= 0 ? `anime-suggestion-${activeIndex}` : undefined
            }
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
          />
          {showPopover ? (
            <SuggestionPopover
              query={normalizedQuery}
              loading={suggestionsQuery.isFetching}
              suggestions={suggestions}
              activeIndex={activeIndex}
              onSelect={openSuggestion}
            />
          ) : null}
        </form>
      </div>
    </div>
  );
}

type SuggestionPopoverProps = {
  query: string;
  loading: boolean;
  suggestions: Array<{
    title: string;
    slug: string;
    poster: string;
    episode_note: string | null;
  }>;
  activeIndex: number;
  onSelect: (index: number) => void;
};

function SuggestionPopover({
  query,
  loading,
  suggestions,
  activeIndex,
  onSelect,
}: SuggestionPopoverProps) {
  let content: ReactNode;
  if (loading) {
    content = (
      <p className={styles.state} role="status">
        Đang tìm…
      </p>
    );
  } else if (suggestions.length === 0) {
    content = (
      <p className={styles.state} role="status">
        Không có gợi ý. Nhấn Enter để tìm “{query}”.
      </p>
    );
  } else {
    content = (
      <ul className={styles.suggestions} id={listboxId} role="listbox">
        {suggestions.map((item, index) => (
          <li
            className={styles.option}
            id={`anime-suggestion-${index}`}
            key={item.slug}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(index)}
          >
            {item.poster ? (
              <img src={item.poster} alt="" loading="lazy" />
            ) : (
              <span className={styles.posterPlaceholder} aria-hidden="true" />
            )}
            <span>
              <strong>{item.title}</strong>
              {item.episode_note ? <small>{item.episode_note}</small> : null}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return <div className={styles.popover}>{content}</div>;
}
