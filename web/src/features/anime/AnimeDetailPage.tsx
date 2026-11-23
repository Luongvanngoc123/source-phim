import { Link, useParams } from "react-router";
import type { AnimeDetail } from "../../api/types";
import { useAnime } from "../../api/queries";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { ButtonLink, GenreLinks, Screen, SubtitleLine } from "../../components";
import {
  countText,
  parseProgress,
  playLabel,
  statusLine,
} from "../../lib/format";
import { EpisodeList } from "./EpisodeList";
import { failureTitle } from "./failureTitle";
import { LoadFailure } from "./LoadFailure";
import styles from "./AnimeDetailPage.module.css";

function DetailSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden="true">
      <div className={styles.skeletonScreen} />
      <div className={styles.skeletonHeading} />
      <div className={styles.skeletonText} />
      <div className={styles.skeletonTextShort} />
      <div className={styles.skeletonFacts} />
    </div>
  );
}

type Fact = {
  label: string;
  value: string | null;
};

function episodeCountText(duration: string | null): string | null {
  if (!duration?.trim()) {
    return null;
  }
  const { aired, total } = parseProgress(duration);
  if (aired === null) {
    return duration;
  }
  if (total !== null && aired === total) {
    return `Trọn bộ ${total} tập`;
  }
  if (total !== null) {
    return `Đã chiếu ${aired}/${total} tập`;
  }
  return `Đã chiếu ${aired} tập`;
}

function factsFor(detail: AnimeDetail): Fact[] {
  return [
    { label: "Lịch chiếu", value: detail.schedule },
    { label: "Trạng thái", value: detail.status },
    { label: "Số tập", value: episodeCountText(detail.duration) },
    { label: "Mùa", value: detail.season_release },
    { label: "Studio", value: detail.studio },
    { label: "Đạo diễn", value: detail.director },
    { label: "Quốc gia", value: detail.country },
    { label: "Chất lượng", value: detail.quality },
    { label: "Ngôn ngữ", value: detail.language },
    { label: "Độ tuổi", value: detail.age_rating },
    { label: "Lượt xem", value: countText(detail.views) ?? detail.views },
    {
      label: "Người theo dõi",
      value: countText(detail.followers) ?? detail.followers,
    },
  ].filter((fact) => Boolean(fact.value?.trim()));
}

function formatPathFor(slug: string | undefined): string | null {
  if (slug === "anime-bo") {
    return paths.catalog("series");
  }
  if (slug === "anime-le") {
    return paths.catalog("movies");
  }
  return null;
}

function DetailScreen({ detail }: { detail: AnimeDetail }) {
  const image = detail.banner || detail.poster;
  const fit = detail.banner ? "cover" : "contain";
  return (
    <Screen className={styles.hero} image={image} fit={fit} alt={detail.title}>
      <SubtitleLine live>{statusLine(detail)}</SubtitleLine>
    </Screen>
  );
}

function RelatedParts({ detail }: { detail: AnimeDetail }) {
  if (detail.seasons.length === 0) {
    return null;
  }
  return (
    <section className={styles.related} aria-labelledby="related-title">
      <h2 id="related-title">Các phần liên quan</h2>
      <ul>
        {detail.seasons.map((part) => (
          <li key={part.slug}>
            <Link
              to={paths.anime(part.slug)}
              aria-current={part.active ? "page" : undefined}
              className={part.active ? styles.relatedCurrent : undefined}
            >
              {part.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Genres({ detail }: { detail: AnimeDetail }) {
  if (detail.genres.length === 0) {
    return null;
  }
  const formatGenre = detail.genres[0];
  const formatPath = formatPathFor(formatGenre?.slug);
  const genreItems = detail.genres.filter(
    (genre) => genre.slug !== "anime-bo" && genre.slug !== "anime-le",
  );
  return (
    <section className={styles.genres} aria-labelledby="genres-title">
      <h2 id="genres-title">Thể loại</h2>
      {formatGenre && formatPath ? (
        <Link to={formatPath}>{formatGenre.name}</Link>
      ) : null}
      <GenreLinks genres={genreItems} />
    </section>
  );
}

function DetailHeader({ detail }: { detail: AnimeDetail }) {
  return (
    <header className={styles.header}>
      <h1>{detail.title}</h1>
      <div className={styles.topLine}>
        {detail.sub_title ? (
          <span className={styles.alternative}>{detail.sub_title}</span>
        ) : null}
        {detail.rating ? (
          <span className="font-figure">{detail.rating}</span>
        ) : null}
        {detail.rating_count ? (
          <span>
            {countText(detail.rating_count) ?? detail.rating_count} lượt đánh
            giá
          </span>
        ) : null}
        {detail.quality ? <span>{detail.quality}</span> : null}
      </div>
    </header>
  );
}

export function AnimeDetailPage() {
  const { slug } = useParams();
  const query = useAnime(slug);
  const detail = query.data;
  const loadingTitle = query.isError
    ? failureTitle(query.error)
    : "Đang tải phim…";
  const pageTitle = detail?.title ?? loadingTitle;
  usePageTitle(pageTitle);

  if (query.isFetching && !detail) {
    return (
      <div className={styles.page}>
        <h1>{pageTitle}</h1>
        <DetailSkeleton />
      </div>
    );
  }

  if (!detail || query.isError) {
    return (
      <div className={styles.page}>
        <h1>{pageTitle}</h1>
        <LoadFailure error={query.error} retry={() => void query.refetch()} />
      </div>
    );
  }

  const newest = detail.episodes.at(-1);
  const first = detail.episodes[0];
  const facts = factsFor(detail);

  return (
    <div className={styles.page}>
      <DetailHeader detail={detail} />
      <div className={styles.content}>
        <main className={styles.primary}>
          <DetailScreen detail={detail} />
          <div className={styles.actions}>
            {newest ? (
              <ButtonLink
                variant="play"
                to={paths.watch(detail.slug, newest.episode_id)}
              >
                {playLabel(newest.episode)}
              </ButtonLink>
            ) : null}
            {detail.episodes.length > 1 && first ? (
              <ButtonLink to={paths.watch(detail.slug, first.episode_id)}>
                Xem từ tập 1
              </ButtonLink>
            ) : null}
          </div>
          {detail.description ? (
            <p className={styles.synopsis}>{detail.description}</p>
          ) : null}
          <RelatedParts detail={detail} />
          <EpisodeList slug={detail.slug} episodes={detail.episodes} />
        </main>
        <aside className={styles.sidebar}>
          {facts.length > 0 ? (
            <dl className={styles.facts}>
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <Genres detail={detail} />
        </aside>
      </div>
    </div>
  );
}
