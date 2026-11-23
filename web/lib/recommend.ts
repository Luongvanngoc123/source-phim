import { getCatalogPage, TYPE_CATEGORY_SLUGS, type CatalogSpec } from "@/lib/catalog";
import type { FilmRef, ProgressEntry } from "@/lib/account";

export interface RecommendationShelf {
  title: string;
  spec: CatalogSpec;
}

export interface RecommendationHistory {
  saved: { film: FilmRef; saved_at: number }[];
  progress: ProgressEntry[];
}

interface Signal {
  genre: { slug: string; name: string };
  source: FilmRef["source"];
  score: number;
}

const MAX_SHELVES = 8;

/** Shown to a reader with no history yet; the starting point moves on by one each day. */
const dailyGenres = [
  { slug: "hanh-dong", name: "Hành động", source: "kk" as const },
  { slug: "phieu-luu", name: "Phiêu lưu", source: "kk" as const },
  { slug: "comedy", name: "Hài hước", source: "avs" as const },
  { slug: "romance", name: "Tình cảm", source: "avs" as const },
  { slug: "fantasy", name: "Kỳ ảo", source: "avs" as const },
  { slug: "drama", name: "Chính kịch", source: "avs" as const },
  { slug: "sci-fi", name: "Khoa học viễn tưởng", source: "avs" as const },
  { slug: "mystery", name: "Bí ẩn", source: "avs" as const },
];

function toSpec(source: FilmRef["source"], genre: string): CatalogSpec {
  return source === "kk" ? { source, category: genre } : { source, genre };
}

/**
 * Rule-based recommendations: the genres of what the reader watched and saved, weighted by
 * how recent each one is, decide which catalog shelves are shown. No model is involved.
 */
export function buildRecommendationPlan(
  history: RecommendationHistory,
  now = Date.now(),
): RecommendationShelf[] {
  const watched = new Map<string, ProgressEntry>();
  for (const entry of history.progress) {
    const previous = watched.get(entry.film.id);
    if (!previous || entry.updated_at > previous.updated_at) watched.set(entry.film.id, entry);
  }
  const signals = new Map<string, Signal>();
  const genresOf = (film: FilmRef) =>
    film.genres.filter((genre) => !TYPE_CATEGORY_SLUGS[genre.slug]);
  const addSignals = (film: FilmRef, timestamp: number, weight: number) => {
    const ageDays = Math.max(0, (now - timestamp * 1000) / 86_400_000);
    const recency = 1 / (1 + ageDays / 14);
    for (const genre of genresOf(film)) {
      const key = `${film.source}:${genre.slug}`;
      const existing = signals.get(key);
      if (existing) existing.score += weight * recency;
      else signals.set(key, { genre, source: film.source, score: weight * recency });
    }
  };
  for (const item of history.saved) addSignals(item.film, item.saved_at, 2);
  for (const entry of watched.values()) addSignals(entry.film, entry.updated_at, 3);

  // One shelf per catalog listing: two titles for the same listing would show the same films.
  const usedGenres = new Set<string>();
  const plan: RecommendationShelf[] = [];
  for (const entry of [...watched.values()]
    .sort((a, b) => b.updated_at - a.updated_at)
    .slice(0, 3)) {
    const genre = genresOf(entry.film)[0];
    if (!genre) continue;
    const key = `${entry.film.source}:${genre.slug}`;
    if (usedGenres.has(key)) continue;
    usedGenres.add(key);
    plan.push({
      title: `Vì bạn đã xem ${entry.film.title}`,
      spec: toSpec(entry.film.source, genre.slug),
    });
  }
  for (const signal of [...signals.values()].sort((a, b) => b.score - a.score)) {
    if (plan.length >= MAX_SHELVES) break;
    const key = `${signal.source}:${signal.genre.slug}`;
    if (usedGenres.has(key)) continue;
    usedGenres.add(key);
    plan.push({
      title: `Vì bạn thích ${signal.genre.name}`,
      spec: toSpec(signal.source, signal.genre.slug),
    });
  }
  if (plan.length > 0) return plan;

  const day = Math.floor(now / 86_400_000);
  return dailyGenres.map((_, index) => {
    const genre = dailyGenres[(day + index) % dailyGenres.length];
    return {
      title: `Gợi ý hôm nay: ${genre.name}`,
      spec: toSpec(genre.source, genre.slug),
    };
  });
}

export async function getRecommendationShelf(
  shelf: RecommendationShelf,
  excludedIds: ReadonlySet<string>,
): Promise<IMovie[]> {
  const result = await getCatalogPage(shelf.spec, 1);
  return result.items.filter((movie) => !excludedIds.has(movie.slug));
}

export function recommendationExcludedIds(history: RecommendationHistory): Set<string> {
  return new Set([
    ...history.saved.map((item) => item.film.id),
    ...history.progress.map((entry) => entry.film.id),
  ]);
}
