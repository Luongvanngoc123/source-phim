import type { AnimeListItem } from "../api/types";
import { TitleCard } from "./TitleCard";
import styles from "./TitleGrid.module.css";

type TitleGridProps = {
  items: AnimeListItem[];
};

export function TitleGrid({ items }: TitleGridProps) {
  return (
    <ul className={styles.grid}>
      {items.map((item) => (
        <li key={item.slug}>
          <TitleCard item={item} />
        </li>
      ))}
    </ul>
  );
}

type TitleGridSkeletonProps = {
  count?: number;
};

export function TitleGridSkeleton({ count = 12 }: TitleGridSkeletonProps) {
  const skeletons = Array.from({ length: Math.max(0, count) });

  return (
    <>
      <span className="visually-hidden">Đang tải danh sách…</span>
      <ul className={styles.grid} aria-hidden="true">
        {skeletons.map((_, index) => (
          <li key={`skeleton-${index}`} className={styles.skeleton}>
            <div />
            <span />
          </li>
        ))}
      </ul>
    </>
  );
}
