import type { AnimeDetail, AnimeListItem, Episode, FeaturedItem } from "@/types/engine";

const ITEMS_PER_PAGE = 30;
/** The source's cards render `lang` 0 as "Phụ đề"; every stream of the engine is VietSub. */
const LANG_SUBTITLED = 0;

/** "09/??" -> ["09", "?"]. Falls back to the number in a badge such as "TẬP 09". */
function splitProgress(progress: string | null, badge: string | null = null): [string, string] {
  const parts = progress?.split("/");
  if (parts?.length === 2) {
    return [parts[0].trim(), parts[1].includes("?") ? "?" : parts[1].trim()];
  }
  return [badge?.match(/\d+/)?.[0] ?? "", ""];
}

/** "9.7" -> 9.7 */
function decimal(text: string | null): number {
  return Number(text?.replace(",", ".")) || 0;
}

export function toMovie(item: AnimeListItem | FeaturedItem): IMovie {
  const [episodeCurrent, episodeTotal] = splitProgress(item.progress, item.episode_badge);
  const banner = "banner" in item && item.banner ? item.banner : "";
  // A countdown badge ("13h 12m 1s") would freeze on screen; only the plain label is shown.
  const upcomingLabel = item.countdown_seconds === null ? item.schedule_badge : null;
  // Catalogs put a view count in this field ("Lượt xem: 1,491,367"); the schedule puts alternative titles.
  const subtitle = item.views_or_subtitle ?? "";
  return {
    _id: item.slug,
    name: item.title,
    origin_name: subtitle.startsWith("Lượt xem") ? "" : subtitle,
    slug: item.slug,
    content: item.description ?? "",
    thumb_url: banner || item.poster,
    poster_url: item.poster,
    backdrops: banner ? [banner] : [],
    badges: upcomingLabel ? [{ type: "new", text: upcomingLabel }] : [],
    episode_current: episodeCurrent,
    episode_total: episodeTotal,
    quality: item.quality ?? "",
    lang: [LANG_SUBTITLED],
    year: Number(item.year) || 0,
    rating: decimal(item.rating),
    category: item.genres,
  };
}

export function detailToMovie(detail: AnimeDetail): IMovie {
  const [episodeCurrent, episodeTotal] = splitProgress(detail.duration);
  return {
    _id: detail.slug,
    name: detail.title,
    origin_name: detail.sub_title ?? "",
    slug: detail.slug,
    content: detail.description,
    thumb_url: detail.banner || detail.poster,
    poster_url: detail.poster,
    backdrops: detail.banner ? [detail.banner] : [],
    badges: [],
    episode_current: episodeCurrent,
    episode_total: episodeTotal,
    quality: detail.quality ?? "",
    lang: [LANG_SUBTITLED],
    year: Number(detail.season_release?.match(/\d{4}/)?.[0]) || 0,
    rating: decimal(detail.rating),
    category: detail.genres,
  };
}

/**
 * Badge text for a card: "Tập 09", "Tập 07/12" when the total is known, the upstream's own
 * marker when it is not a number ("PV", "Full"), and "" for a title without episodes.
 */
export function episodeLabel(movie: IMovie): string {
  const current = movie.episode_current;
  if (!/^\d/.test(current)) {
    return current;
  }
  const total = movie.episode_total;
  return total && total !== "?" ? `Tập ${current}/${total}` : `Tập ${current}`;
}

/** Route segment of an episode's watch page: the upstream's own, e.g. "tap-01-115975". */
export function episodeSlug(episode: Episode): string {
  const lastSegment = episode.watch_url.split(/[?#]/)[0].split("/").pop() ?? "";
  return lastSegment.replace(/\.html$/, "") || `tap-${episode.episode_id}`;
}

/** Matches on the trailing digits of the route slug, which are the engine's `episode_id`. */
export function findEpisode(detail: AnimeDetail, tapSlug: string): Episode | undefined {
  const episodeId = tapSlug.match(/(\d+)$/)?.[1];
  return detail.episodes.find((episode) => episode.episode_id === episodeId);
}

export function detailToEpisodes(detail: AnimeDetail): IEpisode[] {
  return detail.episodes.map((episode) => ({
    _id: episode.episode_id,
    name: episode.title,
    slug: episodeSlug(episode),
  }));
}

/**
 * The engine reports `total_pages` only when the upstream page shows it. Without it the total
 * stays unknown (`null`) and a full page is taken to have a successor.
 */
export function toPagination(page: number, count: number, totalPages?: number | null): IPagination {
  const currentPage = Math.max(1, page);
  const knownTotal = totalPages ?? null;
  return {
    totalItems: (currentPage - 1) * ITEMS_PER_PAGE + count,
    totalPages: knownTotal,
    currentPage,
    itemsPerPage: ITEMS_PER_PAGE,
    hasNext: knownTotal === null ? count === ITEMS_PER_PAGE : currentPage < knownTotal,
  };
}

/** "winter/2026" -> "winter-2026" */
export function seasonRouteSlug(seasonSlug: string): string {
  return seasonSlug.replace("/", "-");
}

/** "winter-2026" -> "winter/2026" */
export function seasonApiSlug(routeSlug: string): string {
  return routeSlug.replace(/-(\d{4})$/, "/$1");
}
