import { useEffect, useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAnime } from "../../api/queries";
import { LightsToggle } from "../../app/LightsToggle";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { Button, Notice, Screen, SubtitleLine } from "../../components";
import { episodeTitle, playLabel } from "../../lib/format";
import { EpisodeList } from "./EpisodeList";
import { failureTitle } from "./failureTitle";
import { LoadFailure } from "./LoadFailure";
import { useHlsPlayer } from "./useHlsPlayer";
import styles from "./WatchPage.module.css";

function WatchSkeleton() {
  return <div className={styles.skeleton} aria-hidden="true" />;
}

function PlayerStatus({
  state,
  error,
  title,
}: {
  state: "preparing" | "ready" | "playing" | "blocked" | "error";
  error: "not-found" | "fatal" | null;
  title: string;
}) {
  if (state === "preparing") {
    return <SubtitleLine live>Đang chuẩn bị {title}…</SubtitleLine>;
  }
  if (error === "not-found") {
    return (
      <SubtitleLine live>
        Tập này chưa có nguồn phát. Chọn tập khác.
      </SubtitleLine>
    );
  }
  if (error === "fatal") {
    return (
      <SubtitleLine live>
        Không phát được tập này. Thử lại hoặc chọn tập khác.
      </SubtitleLine>
    );
  }
  return null;
}

function EpisodeNavigation({
  slug,
  episodes,
  index,
}: {
  slug: string;
  episodes: { episode_id: string }[];
  index: number;
}) {
  const previous = episodes[index - 1];
  const next = episodes[index + 1];
  return (
    <nav className={styles.navigation} aria-label="Chuyển tập">
      {previous ? (
        <Link to={paths.watch(slug, previous.episode_id)}>Tập trước</Link>
      ) : (
        <span>Tập trước</span>
      )}
      {next ? (
        <Link to={paths.watch(slug, next.episode_id)}>Tập sau</Link>
      ) : (
        <span>Tập sau</span>
      )}
    </nav>
  );
}

export function WatchPage() {
  const { slug, episodeId } = useParams();
  const query = useAnime(slug);
  const detail = query.data;
  const episode = detail?.episodes.find(
    (item) => item.episode_id === episodeId,
  );
  const episodeIndex =
    detail?.episodes.findIndex((item) => item.episode_id === episodeId) ?? -1;
  const videoRef = useRef<HTMLVideoElement>(null);
  const navigate = useNavigate();
  const player = useHlsPlayer(
    videoRef,
    episode?.watch_url,
    episode?.episode_id,
  );
  const loadingName = query.isError
    ? failureTitle(query.error)
    : "Đang tải tập…";
  const pageName =
    episode && detail
      ? `${episodeTitle(episode.episode)}, ${detail.title}`
      : loadingName;
  usePageTitle(pageName);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !detail || !episode || episodeIndex < 0) {
      return undefined;
    }
    const next = detail.episodes[episodeIndex + 1];
    if (!next) {
      return undefined;
    }
    const onEnded = () => {
      navigate(paths.watch(detail.slug, next.episode_id));
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
  }, [detail, episode, episodeIndex, navigate]);

  if (query.isFetching && !detail) {
    return (
      <div className={styles.page}>
        <h1>Đang tải phim…</h1>
        <WatchSkeleton />
      </div>
    );
  }

  if (query.isError || !detail) {
    return (
      <div className={styles.page}>
        <h1>{pageName}</h1>
        <LoadFailure error={query.error} retry={() => void query.refetch()} />
      </div>
    );
  }

  if (!episode || episodeIndex < 0) {
    return (
      <div className={styles.page}>
        <h1>Không tìm thấy tập này.</h1>
        <Notice kind="empty" title="Không tìm thấy tập này.">
          <Link to={paths.anime(detail.slug)}>Về trang phim</Link>
        </Notice>
      </div>
    );
  }

  const playText = playLabel(episode.episode);
  const title = playText.slice("Xem ".length);
  const showRetry = player.error === "fatal";

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <section className={styles.playerColumn} aria-label="Trình phát">
          <Screen className={styles.playerScreen}>
            <video
              className={styles.video}
              ref={videoRef}
              controls
              playsInline
              hidden={player.state === "error"}
              aria-label={`${detail.title}, ${title}`}
            />
            <PlayerStatus
              state={player.state}
              error={player.error}
              title={title}
            />
            {player.state === "blocked" ? (
              <Button
                className={styles.resume}
                variant="play"
                onClick={() => void videoRef.current?.play()}
              >
                Xem {title}
              </Button>
            ) : null}
          </Screen>
          {showRetry ? (
            <div className={styles.retry}>
              <Button type="button" onClick={player.retry}>
                Thử lại
              </Button>
            </div>
          ) : null}
          <div className={styles.belowPlayer}>
            <h1>
              <Link to={paths.anime(detail.slug)}>{detail.title}</Link>, {title}
            </h1>
            <div className={styles.playerActions}>
              <EpisodeNavigation
                slug={detail.slug}
                episodes={detail.episodes}
                index={episodeIndex}
              />
              <LightsToggle />
            </div>
          </div>
        </section>
        <EpisodeList
          key={episode.episode_id}
          slug={detail.slug}
          episodes={detail.episodes}
          currentEpisodeId={episode.episode_id}
        />
      </div>
    </div>
  );
}
