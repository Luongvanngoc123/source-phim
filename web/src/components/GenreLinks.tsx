import { Link } from "react-router";
import type { Genre } from "../api/types";
import { paths } from "../app/paths";
import styles from "./GenreLinks.module.css";

type GenreLinksProps = {
  genres: Genre[];
};

export function GenreLinks({ genres }: GenreLinksProps) {
  return (
    <ul className={styles.links}>
      {genres.map((genre) => (
        <li key={genre.slug}>
          <Link to={paths.genre(genre.slug)}>{genre.name}</Link>
        </li>
      ))}
    </ul>
  );
}
