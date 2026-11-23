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
import { errorMessage, getAnime } from "@/lib/engine";
import { detailToEpisodes, detailToMovie } from "@/lib/adapter";
import { getRelated } from "@/lib/related";
import { paths } from "@/lib/paths";
import { useAsync } from "@/lib/useAsync";

const EPISODES_PER_RANGE = 100;

interface EpisodeItem {
  _id: string;
  slug: string;
  label: string;
}

function text(value: string | null | undefined): value is string {
  return Boolean(value?.trim());
}

function FilmPage() {
  const router = useRouter();
  const slug =
    router.isReady && typeof router.query.slug === "string" ? router.query.slug : undefined;
  const film = useAsync(slug ? () => getAnime(slug) : null, [slug]);
  const detail = film.data;
  const related = useAsync(detail ? () => getRelated(detail) : null, [detail]);
  const [activeRange, setActiveRange] = useState(0);

  const movie = detail ? detailToMovie(detail) : null;
  const episodes = useMemo<EpisodeItem[]>(() => {
    if (!detail) return [];
    const mapped = detailToEpisodes(detail);
    return mapped.map((episode, index) => ({
      _id: episode._id,
      slug: episode.slug,
      label: detail.episodes[index]?.episode || episode.name,
    }));
  }, [detail]);

  const episodeRanges = useMemo(() => {
    const ranges: EpisodeItem[][] = [];
    for (let index = 0; index < episodes.length; index += EPISODES_PER_RANGE) {
      ranges.push(episodes.slice(index, index + EPISODES_PER_RANGE));
    }
    return ranges;
  }, [episodes]);

  useEffect(() => {
    setActiveRange(0);
  }, [detail?.slug]);

  if (!slug || film.loading) {
    return <LoadingOverlay />;
  }

  if (film.error) {
    if (film.error.status === 404) {
      return <EmptyState message="Không tìm thấy phim này." />;
    }
    return <ErrorState message={errorMessage(film.error)} onRetry={film.reload} />;
  }

  if (!detail || !movie) {
    return <EmptyState message="Phim này chưa có dữ liệu." />;
  }

  const poster = movie.poster_url;
  const backdrop = movie.thumb_url || poster;
  const firstEpisode = episodes[0];
  const visibleEpisodes = episodeRanges[activeRange] ?? [];
  const seoDescription = detail.description.slice(0, 160);

  return (
    <>
      <NextSeo
        title={detail.title}
        description={seoDescription}
        openGraph={{
          type: "video.movie",
          title: detail.title,
          description: seoDescription,
          images: poster ? [{ url: poster, alt: detail.title }] : [],
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
                    <Image
                      src={poster}
                      alt={detail.title}
                      fill
                      className={styles.x}
                      sizes="155px"
                    />
                  </div>
                </div>
              )}

              <h1 className={styles.o}>{detail.title}</h1>
              {text(detail.sub_title) && <h2 className={styles.q}>{detail.sub_title}</h2>}

              <div className={styles.k}>
                <div className={styles.j}>
                  {text(detail.rating) && (
                    <span className={styles.s}>
                      <i className="fa-solid fa-star"></i>{" "}
                      <span className={styles.y}>{detail.rating}</span>
                    </span>
                  )}
                  {text(detail.rating_count) && (
                    <span className={styles.r}>{detail.rating_count} đánh giá</span>
                  )}
                  {text(detail.views) && <span className={styles.r}>{detail.views}</span>}
                  {text(detail.status) && <span className={styles.r}>{detail.status}</span>}
                  {text(detail.quality) && <span className={styles.u}>{detail.quality}</span>}
                  {text(detail.age_rating) && <span className={styles.r}>{detail.age_rating}</span>}
                  {text(detail.language) && <span className={styles.r}>{detail.language}</span>}
                </div>

                {detail.genres.length > 0 && (
                  <div className={styles.t}>
                    {detail.genres.map((genre) => (
                      <Link
                        scroll={false}
                        key={genre.slug}
                        href={paths.genre(genre.slug)}
                        className={styles.w}
                      >
                        {genre.name}
                      </Link>
                    ))}
                  </div>
                )}

                {text(detail.duration) && (
                  <div className={styles.v}>
                    <div className={styles.z}>
                      <span>Tiến độ: {detail.duration}</span>
                    </div>
                  </div>
                )}

                <div className={styles.as}>
                  {text(detail.description) && (
                    <div className={styles.ad}>
                      <div className={styles.ag}>Giới thiệu</div>
                      <p className={styles.ah}>{detail.description}</p>
                    </div>
                  )}
                  <div className={styles.af}>
                    {text(detail.season_release) && (
                      <div className="flex items-center gap-3">
                        <span className="font-medium">Phát hành:</span>
                        <p className="text-gray-400">{detail.season_release}</p>
                      </div>
                    )}
                    {text(detail.schedule) && (
                      <div className="flex items-start gap-3">
                        <span className="font-medium whitespace-nowrap">Lịch chiếu:</span>
                        <p className="text-gray-400">{detail.schedule}</p>
                      </div>
                    )}
                    {text(detail.country) && (
                      <div className="flex items-center gap-3">
                        <span className="font-medium whitespace-nowrap">Quốc gia:</span>
                        <p className="text-gray-400">{detail.country}</p>
                      </div>
                    )}
                    {text(detail.studio) && (
                      <div className="flex items-start gap-3">
                        <span className="font-medium whitespace-nowrap">Sản xuất:</span>
                        <p className="text-gray-400">{detail.studio}</p>
                      </div>
                    )}
                    {text(detail.director) && (
                      <div className="flex items-start gap-3">
                        <span className="font-medium whitespace-nowrap">Đạo diễn:</span>
                        <p className="text-gray-400">{detail.director}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="lg:backdrop-blur-[20px] px-0 lg:px-8 pt-6 pb-6 lg:shadow-[0_15px_15px_0_rgba(0,0,0,0.125)] lg:rounded-2xl lg:bg-[rgba(255,255,255,.05)]">
              <div className="flex text-white items-center">
                {firstEpisode ? (
                  <Link scroll={false} href={paths.watch(slug, firstEpisode.slug)}>
                    <button className="px-20 py-3 lg:px-8 lg:py-3.5 text-nowrap w-auto flex items-center space-x-3 justify-center text-black font-medium rounded-full bg-[linear-gradient(39deg,rgb(var(--primary)),rgb(211,255,221))] hover:opacity-90 transition-opacity">
                      <i className="fa-solid fa-play text-sm lg:text-base" />
                      <span className="text-base lg:text-lg">Xem ngay</span>
                    </button>
                  </Link>
                ) : text(detail.schedule) ? (
                  <p className="text-gray-300">{detail.schedule}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-6 px-5 lg:px-10">
              {detail.seasons.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-white font-semibold text-xl mb-4">Các phần</h3>
                  <div className="flex flex-wrap gap-3">
                    {detail.seasons.map((part) => (
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
                        <span>{part.name}</span>
                        {text(part.title) && <span className="ml-2">{part.title}</span>}
                        <span className="sr-only">{part.type}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h3 className="text-white font-semibold text-xl mb-4">Tập phim</h3>
                {episodeRanges.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-5" aria-label="Chọn nhóm tập">
                    {episodeRanges.map((range, index) => {
                      const first = range[0]?.label;
                      const last = range[range.length - 1]?.label;
                      return (
                        <button
                          type="button"
                          aria-pressed={activeRange === index}
                          key={`${first}-${last}`}
                          onClick={() => setActiveRange(index)}
                          className={clsx(
                            "rounded-md px-3 py-2 text-sm",
                            activeRange === index
                              ? "bg-primary text-bg-body"
                              : "bg-white/10 text-gray-300 hover:text-white",
                          )}
                        >
                          {first} – {last}
                        </button>
                      );
                    })}
                  </div>
                )}

                {visibleEpisodes.length === 0 ? (
                  <div className="text-gray-400 text-sm mb-12 mt-8">Chưa có tập phim nào.</div>
                ) : (
                  <div className="grid mb-12 mt-8 grid-cols-4 lg:grid-cols-6 gap-4 w-full">
                    {visibleEpisodes.map((episode) => (
                      <div key={episode._id}>
                        <Link
                          href={paths.watch(slug, episode.slug)}
                          className="flex hover:text-primary items-center justify-center py-2.5 md:py-3 lg:py-4 px-1 gap-2 rounded-md bg-[#1c2343]"
                        >
                          <i className="fa-solid fa-play text-xs" />
                          <span>{episode.label}</span>
                        </Link>
                      </div>
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
