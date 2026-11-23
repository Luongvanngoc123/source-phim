import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import clsx from "clsx";

import styles from "./styles.module.css";
import LoadingOverlay from "@/components/loading/loader";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import ProposalGird from "@/components/Movie/ProposalGird";
import SaveButton from "@/components/Account/SaveButton";
import { errorMessage } from "@/lib/engine";
import { getFilm, getRelated } from "@/lib/catalog";
import { toFilmRef } from "@/lib/account";
import { paths } from "@/lib/paths";
import { useAsync } from "@/lib/useAsync";

const EPISODES_PER_RANGE = 100;

function text(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function FilmPage() {
  const router = useRouter();
  const slug =
    router.isReady && typeof router.query.slug === "string" ? router.query.slug : undefined;
  const filmState = useAsync(slug ? () => getFilm(slug) : null, [slug]);
  const film = filmState.data;
  const related = useAsync(film ? () => getRelated(film) : null, [film]);
  const [activeServer, setActiveServer] = useState(0);
  const [activeRange, setActiveRange] = useState(0);

  useEffect(() => {
    setActiveServer(0);
    setActiveRange(0);
  }, [film?.movie.slug]);

  const server = film?.servers[activeServer];
  const episodeRanges = useMemo(() => {
    if (!server) {
      return [];
    }
    const ranges: IEpisode[][] = [];
    for (let index = 0; index < server.episodes.length; index += EPISODES_PER_RANGE) {
      ranges.push(server.episodes.slice(index, index + EPISODES_PER_RANGE));
    }
    return ranges;
  }, [server]);

  if (!slug || filmState.loading) {
    return <LoadingOverlay />;
  }

  if (filmState.error) {
    if (filmState.error.status === 404) {
      return <EmptyState message="Không tìm thấy phim này." />;
    }
    return <ErrorState message={errorMessage(filmState.error)} onRetry={filmState.reload} />;
  }

  if (!film) {
    return <EmptyState message="Phim này chưa có dữ liệu." />;
  }

  const movie = film.movie;
  const poster = movie.poster_url;
  const backdrop = movie.backdrops[0] || movie.thumb_url || poster;
  const firstEpisode = film.servers[0]?.episodes[0];
  const visibleEpisodes = episodeRanges[activeRange] ?? [];
  const description = movie.content.slice(0, 160);

  return (
    <>
      <NextSeo
        title={movie.name}
        description={description}
        openGraph={{
          type: "video.movie",
          title: movie.name,
          description,
          images: poster ? [{ url: poster, alt: movie.name }] : [],
        }}
      />

      <div className={styles.a}>
        <div className={styles.b} style={backdrop ? { backgroundImage: `url(${backdrop})` } : {}} />
        <div className={styles.c}>
          <div
            className={styles.d}
            style={backdrop ? { backgroundImage: `url(${backdrop})` } : {}}
          />
        </div>
      </div>

      <div className={styles.e}>
        <div className={styles.f}>
          <div className={styles.i}>
            <div className={styles.m}>
              {poster && (
                <div className={styles.l}>
                  <div className={styles.n}>
                    <Image src={poster} alt={movie.name} fill className={styles.x} sizes="155px" />
                  </div>
                </div>
              )}

              <h1 className={styles.o}>{movie.name}</h1>
              {text(movie.origin_name) && <h2 className={styles.q}>{movie.origin_name}</h2>}

              <div className={styles.k}>
                <div className={styles.j}>
                  {movie.rating > 0 && (
                    <span className={styles.s}>
                      <i className="fa-solid fa-star" />{" "}
                      <span className={styles.y}>{movie.rating.toFixed(1)}</span>
                    </span>
                  )}
                  {text(movie.quality) && <span className={styles.u}>{movie.quality}</span>}
                  {film.stats.map((stat) => (
                    <span className={styles.r} key={stat}>
                      {stat}
                    </span>
                  ))}
                </div>

                {movie.category.length > 0 && (
                  <div className={styles.t}>
                    {movie.category.map((category) => (
                      <Link
                        scroll={false}
                        key={category.slug}
                        href={category.href}
                        className={styles.w}
                      >
                        {category.name}
                      </Link>
                    ))}
                  </div>
                )}

                {text(movie.episode_current) && (
                  <div className={styles.v}>
                    <div className={styles.z}>
                      <span>Tiến độ: {movie.episode_current}</span>
                    </div>
                  </div>
                )}

                <div className={styles.as}>
                  {text(movie.content) && (
                    <div className={styles.ad}>
                      <div className={styles.ag}>Giới thiệu</div>
                      <p className={styles.ah}>{movie.content}</p>
                    </div>
                  )}
                  <div className={styles.af}>
                    {film.facts.map((fact) => (
                      <div className="flex items-start gap-3" key={fact.label}>
                        <span className="font-medium whitespace-nowrap">{fact.label}:</span>
                        {fact.href ? (
                          <Link href={fact.href} className="text-gray-400 hover:text-primary">
                            {fact.value}
                          </Link>
                        ) : (
                          <p className="text-gray-400">{fact.value}</p>
                        )}
                      </div>
                    ))}
                    {text(film.schedule) && (
                      <div className="flex items-start gap-3">
                        <span className="font-medium whitespace-nowrap">Lịch chiếu:</span>
                        <p className="text-gray-400">{film.schedule}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="lg:backdrop-blur-[20px] px-0 lg:px-8 pt-6 pb-6 lg:shadow-[0_15px_15px_0_rgba(0,0,0,0.125)] lg:rounded-2xl lg:bg-[rgba(255,255,255,.05)]">
              <div className="flex flex-wrap gap-3 text-white items-center">
                {firstEpisode && slug && (
                  <Link
                    scroll={false}
                    href={paths.watch(slug, firstEpisode.slug)}
                    className="px-20 py-3 lg:px-8 lg:py-3.5 text-nowrap w-auto flex items-center space-x-3 justify-center text-black font-medium rounded-full bg-[linear-gradient(39deg,rgb(var(--primary)),rgb(211,255,221))] hover:opacity-90 transition-opacity"
                  >
                    <i className="fa-solid fa-play text-sm lg:text-base" />
                    <span className="text-base lg:text-lg">Xem ngay</span>
                  </Link>
                )}
                <SaveButton
                  film={toFilmRef(movie)}
                  className="rounded-full border border-white/20 px-5 py-3 text-white transition-colors hover:border-primary hover:text-primary"
                />
                {!firstEpisode && text(film.schedule) && (
                  <p className="text-gray-300">{film.schedule}</p>
                )}
              </div>
            </div>

            <div className="mt-6 px-5 lg:px-10">
              {film.parts.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-white font-semibold text-xl mb-4">Các phần</h3>
                  <div className="flex flex-wrap gap-3">
                    {film.parts.map((part) => (
                      <Link
                        key={part.slug}
                        href={paths.film(part.slug)}
                        className={clsx(
                          "rounded-md border px-3 py-2 text-sm transition-colors",
                          part.active
                            ? "border-primary bg-primary text-bg-body"
                            : "border-white/10 bg-white/5 text-gray-300 hover:text-primary",
                        )}
                      >
                        {part.label}
                        <span className="ml-2">{part.title}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-white font-semibold text-xl mb-4">Tập phim</h3>
                {film.servers.length > 1 && (
                  <div className="mb-5 flex flex-wrap gap-2" aria-label="Chọn máy chủ">
                    {film.servers.map((item, index) => (
                      <button
                        type="button"
                        key={`${item.name}-${index}`}
                        aria-pressed={index === activeServer}
                        onClick={() => {
                          setActiveServer(index);
                          setActiveRange(0);
                        }}
                        className={clsx(
                          "rounded-md px-3 py-2 text-sm",
                          index === activeServer
                            ? "bg-primary text-bg-body"
                            : "bg-white/10 text-gray-300 hover:text-white",
                        )}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                )}
                {episodeRanges.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-5" aria-label="Chọn nhóm tập">
                    {episodeRanges.map((range, index) => (
                      <button
                        type="button"
                        aria-pressed={activeRange === index}
                        key={`${range[0]?.slug}-${range[range.length - 1]?.slug}`}
                        onClick={() => setActiveRange(index)}
                        className={clsx(
                          "rounded-md px-3 py-2 text-sm",
                          activeRange === index
                            ? "bg-primary text-bg-body"
                            : "bg-white/10 text-gray-300 hover:text-white",
                        )}
                      >
                        {range[0]?.name} – {range[range.length - 1]?.name}
                      </button>
                    ))}
                  </div>
                )}

                {visibleEpisodes.length === 0 ? (
                  <div className="text-gray-400 text-sm mb-12 mt-8">Chưa có tập phim nào.</div>
                ) : (
                  <div className="grid mb-12 mt-8 grid-cols-4 lg:grid-cols-6 gap-4 w-full">
                    {visibleEpisodes.map((episode) => (
                      <Link
                        key={episode._id}
                        href={paths.watch(movie.slug, episode.slug)}
                        className="flex hover:text-primary items-center justify-center py-2.5 md:py-3 lg:py-4 px-1 gap-2 rounded-md bg-[#1c2343]"
                      >
                        <i className="fa-solid fa-play text-xs" />
                        <span>{episode.name}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {!related.loading && !related.error && related.data && related.data.length > 0 && (
                <section className="mt-10 lg:mt-14">
                  <h3 className="text-white font-semibold mb-8 text-2xl">Có thể bạn sẽ thích</h3>
                  <ProposalGird movies={related.data} />
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default FilmPage;
