import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/router";
import { paths } from "@/lib/paths";
import { suggestFilms } from "@/lib/catalog";

interface SearchBoxProps {
  className?: string;
  placeholder?: string;
  onNavigate?: () => void;
}

export default function SearchBox({
  className,
  placeholder = "Tìm kiếm phim, anime",
  onNavigate,
}: SearchBoxProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IMovie[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const currentRequest = ++requestId.current;
    setActiveIndex(-1);
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setOpen(true);
      void suggestFilms(trimmed)
        .then((items) => {
          if (currentRequest === requestId.current) {
            setResults(items);
            setLoading(false);
          }
        })
        .catch(() => {
          if (currentRequest === requestId.current) {
            setResults([]);
            setLoading(false);
          }
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  const navigate = (movie?: IMovie) => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setOpen(false);
    if (movie) {
      // The typed text has served its purpose once a film is picked from the list.
      setQuery("");
      void router.push(paths.film(movie.slug));
    } else {
      void router.push(paths.search(trimmed));
    }
    onNavigate?.();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp" && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      navigate(activeIndex >= 0 ? results[activeIndex] : undefined);
    }
  };

  return (
    <div ref={rootRef} className={`relative flex w-full flex-col items-center ${className ?? ""}`}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          navigate(activeIndex >= 0 ? results[activeIndex] : undefined);
        }}
        className="relative flex w-full items-center"
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => query.trim().length >= 2 && setOpen(true)}
          onKeyDown={handleKeyDown}
          type="search"
          placeholder={placeholder}
          aria-label={placeholder}
          aria-expanded={open}
          aria-controls="search-suggestions"
          className="h-[2.6rem] w-full rounded-md border border-transparent bg-[rgba(255,255,255,.08)] py-3 pl-10 pr-3 text-white outline-0 placeholder:text-white focus:border-white"
        />
        <button
          type="submit"
          aria-label="Tìm kiếm"
          className="absolute left-0 flex h-[2.6rem] items-center px-3 text-white"
        >
          <i className="fa-solid fa-magnifying-glass"></i>
        </button>
      </form>
      {open && (
        <div
          id="search-suggestions"
          role="listbox"
          className="absolute left-0 top-[3rem] z-[60] w-full overflow-hidden rounded-lg bg-[#20284bfa] py-2 text-white shadow-md"
        >
          {loading && <div className="px-4 py-3 text-sm text-gray-400">Đang tìm...</div>}
          {!loading && results.length === 0 && (
            <div className="px-4 py-3 text-sm text-gray-400">Không tìm thấy phim phù hợp.</div>
          )}
          {!loading && results.length > 0 && (
            <ul>
              {results.map((movie, index) => (
                <li key={`${movie.source}-${movie.slug}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => navigate(movie)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-400/10 ${index === activeIndex ? "bg-gray-400/10 text-primary" : ""}`}
                  >
                    <Image
                      src={movie.poster_url || movie.thumb_url}
                      width={36}
                      height={52}
                      alt=""
                      className="h-[52px] w-9 rounded object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{movie.name}</span>
                      <span className="mt-0.5 block truncate text-xs text-gray-400">
                        {movie.origin_name || (movie.year > 0 ? String(movie.year) : "")}
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary">
                      {movie.source === "kk" ? "Phim" : "Anime"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!loading && query.trim().length >= 2 && (
            <button
              type="button"
              onClick={() => navigate()}
              className="w-full border-t border-white/10 px-4 py-2 text-left text-sm text-primary hover:bg-gray-400/10"
            >
              Xem tất cả kết quả
            </button>
          )}
        </div>
      )}
    </div>
  );
}
