import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import type { NextPage } from "next";
import { NextSeo } from "next-seo";
import clsx from "clsx";

import ErrorState from "@/components/State/ErrorState";
import EmptyState from "@/components/State/EmptyState";
import LoadingOverlay from "@/components/loading/loader";
import ProposalGird2 from "@/components/Movie/ProposalGird2";
import VideoPlayer from "@/components/Player/VideoPlayer";
import EpisodeList from "@/sections/watch/EpisodeList";
import { errorMessage } from "@/lib/engine";
import { findEpisode, getFilm, getRelated, streamUrl } from "@/lib/catalog";
import { toFilmRef } from "@/lib/account";
import { useWatchProgress } from "@/lib/progress";
import { paths } from "@/lib/paths";
import { useAsync } from "@/lib/useAsync";

const AUTO_NEXT_STORAGE_KEY = "animora-auto-next";

const XemPhim: NextPage = () => {
  const router = useRouter();
  const slug =
    router.isReady && typeof router.query.slug === "string" ? router.query.slug : undefined;
  const tap = router.isReady && typeof router.query.tap === "string" ? router.query.tap : undefined;
  const filmState = useAsync(slug ? () => getFilm(slug) : null, [slug]);
  const film = filmState.data;
  const relatedState = useAsync(film ? () => getRelated(film) : null, [film]);
  const match = film && tap ? findEpisode(film, tap) : undefined;
  const movie = film?.movie;
  const currentServerIndex =
    film && match ? film.servers.findIndex((server) => server === match.server) : -1;
  const progress = useWatchProgress(
    movie && match ? toFilmRef(movie) : undefined,
    match ? { slug: match.episode.slug, name: match.episode.name } : undefined,
  );
  const [autoNext, setAutoNext] = useState(true);
  const [theaterMode, setTheaterMode] = useState(false);
  const [lightMode, setLightMode] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    const saved = window.localStorage.getItem(AUTO_NEXT_STORAGE_KEY);
    if (saved !== null) {
      setAutoNext(saved === "true");
    }
  }, []);

  const nextEpisode =
    match && match.server.episodes[match.index + 1]
      ? match.server.episodes[match.index + 1]
      : undefined;
  const previousEpisode =
    match && match.index > 0 ? match.server.episodes[match.index - 1] : undefined;

  const goToNextEpisode = useCallback(() => {
    if (slug && nextEpisode) {
      void router.push(paths.watch(slug, nextEpisode.slug), undefined, { scroll: false });
    }
  }, [nextEpisode, router, slug]);

  const onEnded = useCallback(() => {
    if (autoNext) {
      goToNextEpisode();
    }
  }, [autoNext, goToNextEpisode]);

  const toggleNext = () => {
    setAutoNext((enabled) => {
      const next = !enabled;
      window.localStorage.setItem(AUTO_NEXT_STORAGE_KEY, String(next));
      return next;
    });
  };

  if (!router.isReady || filmState.loading) {
    return <LoadingOverlay />;
  }

  if (filmState.error) {
    if (filmState.error.status === 404) {
      return <EmptyState message="Không tìm thấy phim này." />;
    }
    return <ErrorState message={errorMessage(filmState.error)} onRetry={filmState.reload} />;
  }

  if (!film || !movie || !tap || !match) {
    return (
      <>
        <NextSeo title={`${movie?.name ?? "Phim"} - Không tìm thấy tập`} />
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center text-white">
          <h1 className="text-2xl font-semibold">Không tìm thấy tập phim</h1>
          <p className="text-gray-400">Tập phim này không tồn tại hoặc chưa được cập nhật.</p>
          {film ? (
            <Link
              href={paths.film(film.movie.slug)}
              className="rounded-full bg-primary px-5 py-2 font-medium text-bg-body"
            >
              Quay lại trang phim
            </Link>
          ) : null}
        </div>
      </>
    );
  }

  if (!progress.ready) {
    return <LoadingOverlay />;
  }

  const episode = match.episode;
  // The player is wide, so the wide art comes first; the vertical poster is the fallback.
  const poster = movie.thumb_url || movie.poster_url || "/images/icons/empty-box.svg";
  const episodeTitle = episode.name;
  const onServerChange = (serverIndex: number) => {
    const firstEpisode = film.servers[serverIndex]?.episodes[0];
    if (firstEpisode) {
      void router.push(paths.watch(movie.slug, firstEpisode.slug), undefined, { scroll: false });
    }
  };

  const src = streamUrl(episode);

  return (
    <>
      <NextSeo title={`${movie.name} - ${episodeTitle}`} />

      {lightMode && <div className="pointer-events-none fixed inset-0 z-10 bg-black/70" />}
      <div className="px-5 lg:px-6">
        <div className="flex items-center justify-between py-1.5 md:py-3">
          <div className="flex items-center space-x-3 text-white md:space-x-4">
            <Link
              scroll={false}
              href={paths.film(movie.slug)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-400 hover:bg-white/10 md:h-8 md:w-8"
              aria-label="Thông tin phim"
            >
              <i className="fa-solid fa-angle-left" />
            </Link>
            <span className="text-base font-medium md:text-lg lg:text-xl">{episodeTitle}</span>
          </div>
        </div>
      </div>

      <div
        className={clsx(
          theaterMode
            ? "fixed inset-0 z-30 flex flex-col bg-[#08080A] p-4 md:p-8"
            : "my-3 md:px-5 lg:px-6",
        )}
      >
        {/* Capped to the viewport so the controls stay on screen; the video letterboxes. */}
        <div className="relative z-[15] aspect-video max-h-[calc(100vh-11rem)] w-full overflow-hidden bg-black md:rounded-t-xl">
          <VideoPlayer
            key={src}
            src={src}
            kind={episode.stream.kind}
            title={`${movie.name} - ${episodeTitle}`}
            poster={poster}
            startAt={progress.startAt}
            onProgress={progress.report}
            onEnded={onEnded}
            onNext={nextEpisode ? goToNextEpisode : undefined}
            nextLabel={nextEpisode ? `Tập sau: ${nextEpisode.name}` : undefined}
          />
        </div>
        <div className="bg-[#08080A] py-3 md:rounded-b-xl">
          <div className="flex w-full justify-between px-5">
            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={toggleNext}
                className={`hidden items-center space-x-2 rounded-lg px-3 py-2 lg:flex ${autoNext ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"}`}
              >
                <span>Chuyển tập</span>
                <span
                  className={`rounded-md border px-2 py-1 text-[10px] ${autoNext ? "border-primary text-primary" : "border-gray-500 text-white"}`}
                >
                  {autoNext ? "ON" : "OFF"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTheaterMode((enabled) => !enabled)}
                className={`hidden items-center space-x-2 rounded-lg px-3 py-2 lg:flex ${theaterMode ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"}`}
              >
                <span>Rạp phim</span>
                <span
                  className={`rounded-md border px-2 py-1 text-[10px] ${theaterMode ? "border-primary text-primary" : "border-gray-500 text-white"}`}
                >
                  {theaterMode ? "ON" : "OFF"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setLightMode((enabled) => !enabled)}
                className={`hidden items-center space-x-2 rounded-lg px-3 py-2 lg:flex ${lightMode ? "bg-primary/10 text-primary" : "text-white hover:bg-white/5"}`}
              >
                <span>Đèn</span>
                <span
                  className={`rounded-md border px-2 py-1 text-[10px] ${lightMode ? "border-primary text-primary" : "border-gray-500 text-white"}`}
                >
                  {lightMode ? "ON" : "OFF"}
                </span>
              </button>
            </div>
            {theaterMode && (
              <button
                type="button"
                onClick={() => setTheaterMode(false)}
                className="px-3 py-2 text-sm text-white hover:text-primary"
              >
                Đóng rạp phim
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="px-5 lg:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-11">
          <div className="col-span-1 lg:col-span-8 lg:border-r lg:border-gray-800">
            <div className="hidden p-3 xl:block">
              <div className="grid grid-cols-1 border-b border-gray-800 pb-12 pr-8 lg:grid-cols-12">
                <div className="col-span-7">
                  <div className="flex items-start space-x-6">
                    <div className="w-[60px] flex-shrink-0 md:w-[80px] lg:w-[90px]">
                      <div className="relative block h-0 w-full overflow-hidden rounded-md pb-[160%]">
                        <Image
                          src={poster}
                          alt={movie.name}
                          fill
                          className="absolute inset-0 z-[5] object-cover"
                          sizes="150px"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col">
                      <h3 className="truncate text-xl font-semibold text-white">{movie.name}</h3>
                      {movie.origin_name && (
                        <p className="mt-3 text-[14px] text-primary">{movie.origin_name}</p>
                      )}
                      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11.5px] lg:justify-start lg:px-0">
                        {movie.year > 0 && (
                          <span className="rounded border bg-white/5 px-2 py-0.5 text-white">
                            {movie.year}
                          </span>
                        )}
                        {movie.quality && (
                          <span className="rounded border bg-white/5 px-2 py-0.5 text-white">
                            {movie.quality}
                          </span>
                        )}
                        {movie.category.map((category) => (
                          <Link
                            key={category.slug}
                            href={category.href}
                            className="rounded bg-white/5 px-2 py-1 text-xs text-gray-300 transition-colors hover:text-primary"
                          >
                            {category.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-span-5">
                  <p className="leading-6 text-gray-400">{movie.content}</p>
                  <div className="mt-5">
                    <Link
                      href={paths.film(movie.slug)}
                      className="flex items-center space-x-1.5 text-primary"
                    >
                      <span className="text-sm">Thông tin phim</span>
                      <i className="fa-solid fa-angle-right mt-1 text-xs" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>

            <div className="lg:px-3 lg:pr-8">
              <EpisodeList
                episodes={match.server.episodes}
                servers={film.servers}
                currentServerIndex={currentServerIndex}
                onServerChange={onServerChange}
                currentEpisodeId={episode._id}
                slug={movie.slug}
                collapsed={isCollapsed}
                onToggleCollapsed={() => setIsCollapsed((collapsed) => !collapsed)}
                poster={poster}
              />
              <div className="mb-12 flex items-center justify-between border-b border-gray-800 pb-8">
                {previousEpisode ? (
                  <Link
                    href={paths.watch(movie.slug, previousEpisode.slug)}
                    scroll={false}
                    className="flex items-center gap-2 text-white hover:text-primary"
                  >
                    <i className="fa-solid fa-angle-left" />
                    <span>Tập trước</span>
                  </Link>
                ) : (
                  <span />
                )}
                {nextEpisode ? (
                  <Link
                    href={paths.watch(movie.slug, nextEpisode.slug)}
                    scroll={false}
                    className="flex items-center gap-2 text-white hover:text-primary"
                  >
                    <span>Tập sau</span>
                    <i className="fa-solid fa-angle-right" />
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-3">
            <div className="py-6">
              <div className="px-4 text-lg font-medium text-white">Đề xuất</div>
              {relatedState.data && relatedState.data.length > 0 && (
                <div className="mt-6 px-4">
                  <ProposalGird2 movies={relatedState.data} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default XemPhim;
