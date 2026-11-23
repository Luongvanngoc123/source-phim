import { Link, useParams, useSearchParams } from "react-router";
import { useGenres, useSeason } from "../../api/queries";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { Notice } from "../../components";
import { ListingLayout } from "./ListingLayout";
import styles from "./SeasonPage.module.css";
const seasonLabels: Record<string, string> = {
  winter: "Đông",
  spring: "Xuân",
  summer: "Hạ",
  autumn: "Thu",
};

const seasonOrder = ["winter", "spring", "summer", "autumn"];

function seasonPosition(slug: string): number {
  const [season, year] = slug.split("/");
  const index = seasonOrder.indexOf(season ?? "");
  const numericYear = Number(year);
  return index >= 0 && Number.isInteger(numericYear)
    ? numericYear * seasonOrder.length + index
    : -1;
}

function pageFromParams(params: URLSearchParams): number {
  const page = Number(params.get("trang"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function SeasonPage() {
  const { season = "", year = "" } = useParams();
  const seasonSlug = `${season}/${year}`;
  const [searchParams] = useSearchParams();
  const page = pageFromParams(searchParams);
  const genresQuery = useGenres();
  const query = useSeason(seasonSlug, page);
  const seasonIndex =
    genresQuery.data?.seasons.findIndex((item) => item.slug === seasonSlug) ??
    -1;
  const seasonRef =
    seasonIndex >= 0 ? genresQuery.data?.seasons[seasonIndex] : undefined;
  const isKnownSeason = genresQuery.isSuccess && Boolean(seasonRef);
  const seasonLabel = seasonLabels[season] ?? season;
  const title = seasonRef?.name ?? `Mùa ${seasonLabel} ${year}`;
  usePageTitle(isKnownSeason ? title : "Không có trang này.");

  if (genresQuery.isSuccess && !isKnownSeason) {
    return (
      <section className={styles.page}>
        <h1>Không có trang này.</h1>
        <Link to={paths.home()}>Về trang chủ</Link>
      </section>
    );
  }

  const seasons = genresQuery.data?.seasons ?? [];
  const chronologicalSeasons = [...seasons].sort(
    (left, right) => seasonPosition(left.slug) - seasonPosition(right.slug),
  );
  const chronologicalIndex = chronologicalSeasons.findIndex(
    (item) => item.slug === seasonSlug,
  );
  const previous =
    chronologicalIndex > 0
      ? chronologicalSeasons[chronologicalIndex - 1]
      : undefined;
  const next =
    chronologicalIndex >= 0
      ? chronologicalSeasons[chronologicalIndex + 1]
      : undefined;

  return (
    <section className={styles.page}>
      <h1>{title}</h1>
      {genresQuery.isError ? (
        <Notice
          kind="error"
          title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
          action={{
            label: "Thử lại",
            onClick: () => void genresQuery.refetch(),
          }}
        />
      ) : null}
      <nav className={styles.seasonNav} aria-label="Chuyển mùa">
        {previous ? (
          <Link to={paths.season(previous.slug)}>
            Mùa trước: {previous.name}
          </Link>
        ) : null}
        {next ? (
          <Link to={paths.season(next.slug)}>Mùa sau: {next.name}</Link>
        ) : null}
      </nav>
      <ListingLayout
        items={query.data?.items}
        isFetching={query.isFetching}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        hasNext={(query.data?.count ?? 0) === 30}
        hrefFor={(nextPage) => paths.season(seasonSlug, nextPage)}
        emptyTitle="Chưa có anime trong mùa này."
      />
    </section>
  );
}
