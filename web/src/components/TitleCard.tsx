import { Link } from "react-router";
import type { AnimeListItem } from "../api/types";
import { paths } from "../app/paths";
import { cardCaption } from "../lib/format";
import { Poster } from "./Poster";
import { Rating } from "./Rating";
import styles from "./TitleCard.module.css";

type TitleCardProps = {
  item: AnimeListItem;
};

export function TitleCard({ item }: TitleCardProps) {
  const caption = cardCaption(item);

  return (
    <Link
      className={styles.card}
      to={paths.anime(item.slug)}
      title={item.title}
    >
      <Poster
        className={styles.poster}
        src={item.poster}
        title={item.title}
        caption={caption}
        sizes="(max-width: 600px) 42vw, (max-width: 900px) 20vw, 148px"
      />
      <strong className={styles.title}>{item.title}</strong>
      {item.rating || item.quality ? (
        <span className={styles.meta}>
          {item.rating ? <Rating value={item.rating} /> : null}
          {item.quality ? <span>{item.quality}</span> : null}
        </span>
      ) : null}
    </Link>
  );
}
