import { useGenres, useHome } from "../../api/queries";
import type { GenreRef, SeasonRef } from "../../api/types";
import {
  GenreIndex,
  Notice,
  SeasonMatrix,
  SectionHeading,
  TitleGrid,
} from "../../components";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { AiringSchedule } from "./AiringSchedule";
import { Hero } from "./Hero";
import { HomeSkeleton } from "./HomeSkeleton";
import styles from "./Home.module.css";

export function Home() {
  usePageTitle("Trang chủ");

  const home = useHome();
  const genres = useGenres();
  const titles = home.data;

  if (home.isFetching && !titles) {
    return <HomeSkeleton />;
  }

  return (
    <div className={styles.home}>
      {titles ? (
        <Hero featured={titles.featured} />
      ) : (
        <TitlesFailure onRetry={() => void home.refetch()} />
      )}

      {titles ? (
        <section className={styles.section}>
          <SectionHeading
            title="Mới cập nhật"
            action={{
              label: "Xem tất cả anime bộ",
              to: paths.catalog("series"),
            }}
          />
          <TitleGrid items={titles.latest} />
        </section>
      ) : null}

      <AiringSchedule />

      {titles ? (
        <section className={styles.section}>
          <SectionHeading
            title="Sắp chiếu"
            action={{ label: "Xem tất cả", to: paths.catalog("upcoming") }}
          />
          <TitleGrid items={titles.upcoming} />
        </section>
      ) : null}

      <GenreSeasonSections
        isPending={genres.isFetching && !genres.data}
        isError={genres.isError}
        genres={genres.data?.genres}
        seasons={genres.data?.seasons}
        onRetry={() => void genres.refetch()}
      />
    </div>
  );
}

/** Shown in place of the hero and both title grids when `/api/home` fails. */
function TitlesFailure({ onRetry }: { onRetry: () => void }) {
  return (
    <section>
      <h1 className="visually-hidden">Animora</h1>
      <Notice
        kind="error"
        title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
        action={{ label: "Thử lại", onClick: onRetry }}
      />
    </section>
  );
}

type GenreSeasonSectionsProps = {
  isPending: boolean;
  isError: boolean;
  genres: GenreRef[] | undefined;
  seasons: SeasonRef[] | undefined;
  onRetry: () => void;
};

/** Both blocks come from one request, so they load, fail and recover together. */
function GenreSeasonSections({
  isPending,
  isError,
  genres,
  seasons,
  onRetry,
}: GenreSeasonSectionsProps) {
  if (isPending) {
    return (
      <>
        <section className={styles.section}>
          <SectionHeading title="Thể loại" />
          <div className={styles.indexSkeleton} aria-hidden="true" />
        </section>
        <section className={styles.section}>
          <SectionHeading title="Theo mùa" />
          <div className={styles.matrixSkeleton} aria-hidden="true" />
        </section>
      </>
    );
  }

  if (isError || !genres || !seasons) {
    return (
      <section className={styles.section}>
        <SectionHeading title="Thể loại" />
        <Notice
          kind="error"
          title="Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại."
          action={{ label: "Thử lại", onClick: onRetry }}
        />
      </section>
    );
  }

  return (
    <>
      <section className={styles.section}>
        <SectionHeading title="Thể loại" />
        <GenreIndex genres={genres} />
      </section>
      <section className={styles.section}>
        <SectionHeading title="Theo mùa" />
        <SeasonMatrix seasons={seasons} />
      </section>
    </>
  );
}
