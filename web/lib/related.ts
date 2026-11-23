import type { AnimeDetail } from "@/types/engine";
import { toMovie } from "./adapter";
import { getGenre } from "./engine";

/** The engine lists a title's format among its genres; it says nothing about the content. */
const FORMAT_GENRES: Record<string, true> = { "anime-bo": true, "anime-le": true };

/** Other titles from the first real genre of `detail`, newest first, without the title itself. */
export async function getRelated(detail: AnimeDetail, limit = 12): Promise<IMovie[]> {
  const genre = detail.genres.find((candidate) => !FORMAT_GENRES[candidate.slug]);
  if (!genre) {
    return [];
  }
  const catalog = await getGenre(genre.slug);
  return catalog.items
    .filter((item) => item.slug !== detail.slug)
    .slice(0, limit)
    .map(toMovie);
}
