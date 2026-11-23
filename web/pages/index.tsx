import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import Loader from "@/components/loading/list";
import ErrorState from "@/components/State/ErrorState";
import EmptyState from "@/components/State/EmptyState";
import ContinueWatching from "@/components/home/ContinueWatching";
import Recommendations from "@/components/home/Recommendations";
import ICON from "@/types/icon";
import { GRADIENTS } from "@/utils/Items";
import { getGenres, getHome, errorMessage } from "@/lib/engine";
import { toMovie } from "@/lib/adapter";
import { getCatalogPage, type CatalogSpec } from "@/lib/catalog";
import { paths } from "@/lib/paths";
import { useAsync } from "@/lib/useAsync";
import type { HomeResponse } from "@/types/engine";

const BannerSlider = dynamic(() => import("@/components/home/Banner"), { ssr: false });
const MovieList = dynamic(() => import("@/components/Movie/MovieList"), { ssr: false });
const MovieSlider = dynamic(() => import("@/components/Movie/MovieSlider"), { ssr: false });
const MovieShelf = dynamic(() => import("@/components/Movie/MovieShelf"), { ssr: false });
const NewsList = dynamic(() => import("@/components/Movie/NewsList"), { ssr: false });
const TopList = dynamic(() => import("@/sections/home/Rank/list"), { ssr: false });
const KeyArt = dynamic(() => import("@/components/Movie/KeyArt"), { ssr: false });

/**
 * "list" and "key-art" show vertical posters and suit every title. "slider", "shelf" and
 * "news" show wide art, which only the film catalog has for its list items.
 */
type ShelfLayout = "list" | "key-art" | "slider" | "shelf" | "news";

interface ShelfConfig {
  key: string;
  title: string;
  href: string;
  layout: ShelfLayout;
  spec: CatalogSpec;
}

interface LoadedShelf extends ShelfConfig {
  movies: IMovie[];
}

const SectionHeader = ({ title, link }: { title: string; link: string }) => (
  <div className="flex items-center space-x-2 text-lg lg:text-xl xl:text-2xl mt-6 lg:mt-12">
    <span className="font-semibold text-white">{title}</span>
    <Link
      href={link}
      scroll={false}
      className="group w-8 h-8 flex items-center justify-center border border-white/15 rounded-full cursor-pointer transition-width duration-[2000ms] relative text-white hover:text-[var(--primary)] hover:w-auto text-xl px-2 leading-none"
    >
      <span className="group-hover:block hidden text-xs whitespace-nowrap">Xem thêm</span>
      <ICON.ArrowRight />
    </Link>
  </div>
);

function ShelfContent({ layout, movies }: { layout: ShelfLayout; movies: IMovie[] }) {
  if (layout === "key-art") return <KeyArt movies={movies} />;
  if (layout === "slider") return <MovieSlider movies={movies} />;
  if (layout === "shelf") return <MovieShelf movies={movies} />;
  if (layout === "news") return <NewsList movies={movies} />;
  return <MovieList movies={movies} />;
}

/** Shelves below the fold, loaded one at a time as the reader scrolls to the end of the page. */
const LAZY_SHELVES: ShelfConfig[] = [
  {
    key: "kk-series",
    title: "Phim Bộ Mới Cập Nhật",
    href: paths.kkSeries,
    layout: "slider",
    spec: { source: "kk", list: "phim-bo" },
  },
  {
    key: "kk-movies",
    title: "Phim Lẻ Mới Cập Nhật",
    href: paths.kkMovies,
    layout: "shelf",
    spec: { source: "kk", list: "phim-le" },
  },
  {
    key: "anime-series",
    title: "Anime Bộ Mới Cập Nhật",
    href: paths.animeSeries,
    layout: "list",
    spec: { source: "avs", list: "series" },
  },
  {
    key: "kk-animation",
    title: "Hoạt Hình",
    href: paths.kkAnimation,
    layout: "news",
    spec: { source: "kk", list: "hoat-hinh" },
  },
  {
    key: "anime-movies",
    title: "Anime Lẻ Mới Cập Nhật",
    href: paths.animeMovies,
    layout: "list",
    spec: { source: "avs", list: "movies" },
  },
  {
    key: "kk-tv-shows",
    title: "TV Shows",
    href: paths.kkTvShows,
    layout: "slider",
    spec: { source: "kk", list: "tv-shows" },
  },
  {
    key: "anime-action",
    title: "Anime Hành Động",
    href: paths.topic("hanh-dong"),
    layout: "key-art",
    spec: { source: "avs", genre: "hanh-dong" },
  },
];

const HomePage: React.FC = () => {
  const home = useAsync<HomeResponse>(() => getHome(), []);
  const genres = useAsync(() => getGenres(), []);
  const [shelves, setShelves] = useState<LoadedShelf[]>([]);
  const [queue, setQueue] = useState(LAZY_SHELVES);
  const [isShelfLoading, setIsShelfLoading] = useState(false);
  const [isTopicExpanded, setIsTopicExpanded] = useState(false);
  // The sentinel only exists once the home data has rendered, so it is tracked as state.
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);

  const loadNextShelf = useCallback(async () => {
    if (isShelfLoading || queue.length === 0) return;

    const next = queue[0];
    setIsShelfLoading(true);
    setQueue((current) => current.slice(1));
    try {
      const page = await getCatalogPage(next.spec);
      if (page.items.length > 0) {
        setShelves((current) => [...current, { ...next, movies: page.items }]);
      }
    } catch {
      // A failed shelf is skipped so the next sentinel intersection can continue the queue.
    } finally {
      setIsShelfLoading(false);
    }
  }, [isShelfLoading, queue]);

  useEffect(() => {
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadNextShelf();
      },
      { threshold: 0.1, rootMargin: "400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, loadNextShelf]);

  if (home.loading && !home.data) return <Loader />;
  if (home.error && !home.data) {
    return <ErrorState message={errorMessage(home.error)} onRetry={home.reload} />;
  }

  const homeData = home.data;
  if (!homeData) return <Loader />;

  const featured = homeData.featured.map(toMovie);
  const latest = homeData.latest.map(toMovie);
  const upcoming = homeData.upcoming.map(toMovie);
  const topics = genres.data?.genres ?? [];
  const displayedTopics = isTopicExpanded ? topics : topics.slice(0, 6);
  const remainingTopicsCount = Math.max(0, topics.length - 6);

  return (
    <div className="pb-28">
      <BannerSlider movies={featured} />

      <div className="relative top-[-2rem] z-10 px-5 lg:px-6">
        <div className="text-2xl font-semibold text-white">Bạn đang quan tâm gì?</div>
        {genres.error ? (
          <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />
        ) : topics.length === 0 ? (
          <EmptyState message="Chưa có chủ đề." />
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mt-5">
            {displayedTopics.map((topic, index) => (
              <Link
                href={paths.topic(topic.slug)}
                scroll={false}
                key={topic.slug}
                className={`relative transform transition-transform duration-300 ease-out hover:-translate-y-2 overflow-hidden rounded-xl p-6 text-white bg-gradient-to-br ${GRADIENTS[index % GRADIENTS.length]}
                  after:absolute after:inset-0 after:bg-[url(/images/wave.png)] after:bg-no-repeat after:opacity-30
                  after:[mask-image:linear-gradient(-45deg,black,transparent_40%)]
                  after:bg-[length:200px_140px] after:bg-[position:right_-2rem_bottom_0]
                  flex flex-col justify-end h-24 sm:h-30 lg:h-36`}
              >
                <h3 className="text-base md:text-lg lg:text-xl font-bold relative z-10 w-[80%] line-clamp-2">
                  {topic.name}
                </h3>
                <div className="md:flex hidden font-medium mt-3 items-center relative space-x-2 leading-none z-10">
                  <span>Xem chủ đề</span>
                  <i className="fa-solid fa-angle-right" />
                </div>
              </Link>
            ))}
            {!isTopicExpanded && remainingTopicsCount > 0 && (
              <button
                type="button"
                onClick={() => setIsTopicExpanded(true)}
                className={`cursor-pointer relative transform transition-transform duration-300 ease-out hover:-translate-y-2 overflow-hidden rounded-xl p-6 text-left text-white bg-gradient-to-br from-gray-600 to-gray-800
                  after:absolute after:inset-0 after:bg-[url(/images/wave.png)] after:bg-no-repeat after:opacity-30
                  after:[mask-image:linear-gradient(-45deg,black,transparent_40%)]
                  after:bg-[length:200px_140px] after:bg-[position:right_-2rem_bottom_0]
                  flex flex-col justify-end h-24 sm:h-30 lg:h-full hover:brightness-110`}
              >
                <span className="text-base md:text-lg lg:text-xl font-bold relative z-10">
                  + {remainingTopicsCount} Chủ đề
                </span>
              </button>
            )}
            {isTopicExpanded && (
              <Link
                href={paths.topics}
                className={`relative transform transition-transform duration-300 ease-out hover:-translate-y-2 overflow-hidden rounded-xl p-6 text-white bg-gradient-to-br from-gray-600 to-gray-800
                  after:absolute after:inset-0 after:bg-[url(/images/wave.png)] after:bg-no-repeat after:opacity-30
                  after:[mask-image:linear-gradient(-45deg,black,transparent_40%)]
                  after:bg-[length:200px_140px] after:bg-[position:right_-2rem_bottom_0]
                  flex flex-col justify-end h-24 sm:h-30 lg:h-full`}
              >
                <span className="text-base md:text-lg lg:text-xl font-bold relative z-10">
                  Xem tất cả chủ đề
                </span>
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="relative z-10 px-5 lg:px-6">
        <ContinueWatching />

        <SectionHeader title="Anime Mới Cập Nhật" link={paths.animeSeries} />
        <div className="mt-6">
          <MovieList movies={latest} />
        </div>

        <SectionHeader title="Anime Sắp Chiếu" link={paths.upcoming} />
        <div className="mt-6">
          <MovieList movies={upcoming} />
        </div>

        <TopList movies={featured} />

        {shelves.map((shelf) => (
          <div key={shelf.key} className="animate-fade-in-up">
            <SectionHeader title={shelf.title} link={shelf.href} />
            <div className="mt-6">
              <ShelfContent layout={shelf.layout} movies={shelf.movies} />
            </div>
          </div>
        ))}

        {isShelfLoading || queue.length > 0 ? (
          <div
            ref={setSentinel}
            className="h-24 w-full flex items-center justify-center mt-12 mb-20"
          >
            {isShelfLoading ? (
              <Loader />
            ) : (
              <div className="text-gray-500 text-sm">Đang tải thêm nội dung...</div>
            )}
          </div>
        ) : (
          // The recommendation feed takes over once the fixed shelves are all on the page.
          <Recommendations />
        )}
      </div>
    </div>
  );
};

export default HomePage;
