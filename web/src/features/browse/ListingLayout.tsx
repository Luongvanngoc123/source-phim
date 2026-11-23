import { Link } from "react-router";
import type { AnimeListItem } from "../../api/types";
import { Notice, Pager, TitleGrid, TitleGridSkeleton } from "../../components";
import styles from "./ListingLayout.module.css";

type ListingLayoutProps = {
  items: AnimeListItem[] | undefined;
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  page: number;
  hasNext: boolean;
  hrefFor: (page: number) => string;
  emptyTitle: string;
  emptyDetail?: string;
};

export function ListingLayout({
  items,
  isFetching,
  isError,
  onRetry,
  page,
  hasNext,
  hrefFor,
  emptyTitle,
  emptyDetail,
}: ListingLayoutProps) {
  if (isFetching && !items) {
    return <TitleGridSkeleton />;
  }

  if (isError && !items) {
    return (
      <Notice
        kind="error"
        title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
        action={{ label: "Thử lại", onClick: onRetry }}
      />
    );
  }

  const list = items ?? [];
  if (list.length === 0) {
    if (page > 1) {
      return (
        <section className={styles.endState}>
          <h2>Hết danh sách.</h2>
          <Link to={hrefFor(1)}>Về trang 1</Link>
        </section>
      );
    }

    return (
      <Notice kind="empty" title={emptyTitle}>
        {emptyDetail}
      </Notice>
    );
  }

  return (
    <div
      className={isFetching ? styles.refreshing : undefined}
      aria-busy={isFetching}
    >
      <TitleGrid items={list} />
      <Pager page={page} hasNext={hasNext} hrefFor={hrefFor} />
    </div>
  );
}
