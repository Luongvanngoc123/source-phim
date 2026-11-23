import type { AnimeListItem } from "../../api/types";
import { Rating } from "../../components";
import styles from "./FeaturedList.module.css";

type FeaturedListProps = {
  items: AnimeListItem[];
  selectedSlug: string | undefined;
  onSelect: (slug: string) => void;
};

export function FeaturedList({
  items,
  selectedSlug,
  onSelect,
}: FeaturedListProps) {
  return (
    <aside className={styles.panel} aria-labelledby="featured-heading">
      <h2 id="featured-heading">Đề cử</h2>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.slug}>
            <button
              className={styles.button}
              type="button"
              aria-current={item.slug === selectedSlug ? "true" : undefined}
              onClick={() => onSelect(item.slug)}
            >
              <span>{item.title}</span>
              <Rating value={item.rating} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
