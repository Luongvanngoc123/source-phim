import type { GenreRef } from "../api/types";
import { GenreLinks } from "./GenreLinks";

type GenreIndexProps = {
  genres: GenreRef[];
};

export function GenreIndex({ genres }: GenreIndexProps) {
  return <GenreLinks genres={genres} />;
}
