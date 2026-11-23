import type { ReactNode } from "react";
import { useGenres } from "../../api/queries";
import { usePageTitle } from "../../app/usePageTitle";
import {
  GenreIndex,
  Notice,
  SeasonMatrix,
  SectionHeading,
} from "../../components";
import styles from "./GenresPage.module.css";

export function GenresPage() {
  const query = useGenres();
  usePageTitle("Thể loại");
  let content: ReactNode = null;
  if (query.isFetching && !query.data) {
    content = <Notice kind="loading" title="Đang tải danh sách…" />;
  } else if (query.isError) {
    content = (
      <Notice
        kind="error"
        title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
        action={{ label: "Thử lại", onClick: () => void query.refetch() }}
      />
    );
  } else if (query.data) {
    content = (
      <>
        <GenreIndex genres={query.data.genres} />
        <section>
          <SectionHeading title="Theo mùa" />
          <SeasonMatrix seasons={query.data.seasons} />
        </section>
      </>
    );
  }

  return (
    <section className={styles.page}>
      <h1>Thể loại</h1>
      {content}
    </section>
  );
}
