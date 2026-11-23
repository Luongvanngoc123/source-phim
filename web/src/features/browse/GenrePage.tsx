import { Link, useParams, useSearchParams } from "react-router";
import { useGenre, useGenres } from "../../api/queries";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { ListingLayout } from "./ListingLayout";
import styles from "./GenrePage.module.css";

function pageFromParams(params: URLSearchParams): number {
  const page = Number(params.get("trang"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function GenrePage() {
  const { slug = "" } = useParams();
  const [searchParams] = useSearchParams();
  const page = pageFromParams(searchParams);
  const genresQuery = useGenres();
  const query = useGenre(slug, page);
  const genre = genresQuery.data?.genres.find((item) => item.slug === slug);
  const title = genre?.name ?? slug;
  usePageTitle(`Thể loại ${title}`);

  return (
    <section className={styles.page}>
      <div className={styles.headingRow}>
        <h1>{title || "Đang tải thể loại…"}</h1>
        <Link to={paths.genres()}>Tất cả thể loại</Link>
      </div>
      <ListingLayout
        items={query.data?.items}
        isFetching={query.isFetching}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        hasNext={(query.data?.count ?? 0) === 30}
        hrefFor={(nextPage) => paths.genre(slug, nextPage)}
        emptyTitle="Chưa có anime thuộc thể loại này."
      />
    </section>
  );
}
