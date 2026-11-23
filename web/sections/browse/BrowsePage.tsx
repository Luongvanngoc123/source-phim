import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import MovieGrid from "@/components/Movie/MovieGird";
import { errorMessage, getGenres } from "@/lib/engine";
import { useAsync } from "@/lib/useAsync";
import { toMovie, toPagination } from "@/lib/adapter";
import { paths } from "@/lib/paths";
import type { GenresResponse } from "@/types/engine";

export interface BrowseResponse {
  page: number;
  count: number;
  total_pages?: number | null;
  items: BrowseItem[];
}

export interface BrowseItem {
  title: string;
  slug: string;
  film_id: string | null;
  url: string;
  poster: string;
  episode_badge: string | null;
  schedule_badge: string | null;
  countdown_seconds: number | null;
  air_time: string | null;
  rating: string | null;
  quality: string | null;
  progress: string | null;
  year: string | null;
  views_or_subtitle: string | null;
  description: string | null;
  studio: string | null;
  genres: { name: string; slug: string }[];
  detail_api: string;
}

type BrowseLoader = (page: number) => Promise<BrowseResponse>;

interface BrowsePageProps {
  title: string;
  seoTitle?: string;
  load: BrowseLoader | null;
  directory?: GenresResponse;
}

const selectedClass = "border-gray-600 text-primary";
const optionClass =
  "text-sm transition-colors duration-200 border px-3 py-1.5 rounded-lg text-gray-300 border-transparent hover:text-primary";

function pageFromQuery(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default function BrowsePage({ title, seoTitle, load, directory }: BrowsePageProps) {
  const router = useRouter();
  const [filter, setFilter] = useState(false);
  const currentPage = pageFromQuery(router.query.page);
  const directoryState = useAsync(directory ? null : getGenres, []);
  const catalog = useAsync(load ? () => load(currentPage) : null, [currentPage, load]);
  const genres = directory?.genres ?? directoryState.data?.genres ?? [];
  const seasons = directory?.seasons ?? directoryState.data?.seasons ?? [];
  const response = catalog.data;
  const pagination = response
    ? toPagination(response.page || currentPage, response.count, response.total_pages)
    : undefined;
  const currentPath = router.asPath.split("?")[0];

  const updatePage = (page: number) => {
    if (
      page < 1 ||
      (pagination?.totalPages !== null &&
        pagination?.totalPages !== undefined &&
        page > pagination.totalPages)
    ) {
      return;
    }
    void router.push(
      { pathname: router.pathname, query: { ...router.query, page: String(page) } },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  const typeOptions = [
    { label: "Anime bộ", href: paths.series },
    { label: "Anime lẻ", href: paths.movies },
    { label: "Sắp chiếu", href: paths.upcoming },
  ];

  return (
    <>
      <NextSeo title={seoTitle ?? title} />
      <div className="pb-28 pt-5 px-5 lg:px-6">
        <div className="text-2xl font-semibold text-white">{title}</div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setFilter(!filter)}
            className="inline-flex items-center gap-2 bg-[rgba(var(--bg-body))] py-0 pl-[0.5rem] pr-[0.75rem] h-[30px] text-white cursor-pointer font-medium rounded-[0.3rem]"
          >
            <i className={`fa-solid fa-filter text-xs ${filter ? "text-primary" : ""}`}></i>
            <span className="text-[15px]">Bộ lọc</span>
          </button>

          {filter && (
            <div className="border-1 border rounded-xl border-[#ffffff10] -mt-[15px] mb-12">
              <div className="px-4 mt-4 py-3 border-b border-[#ffffff10] space-x-8 flex items-start justify-start h-full">
                <div className="h-full lg:w-[120px] w-[80px] flex items-center justify-end">
                  <div className="py-1.5 text-sm font-medium text-white">Loại:</div>
                </div>
                <ul className="flex flex-wrap gap-x-1.5 items-center gap-y-3 w-full">
                  {typeOptions.map((option) => (
                    <li key={option.href}>
                      <Link
                        href={option.href}
                        className={`${optionClass} ${currentPath === option.href ? selectedClass : ""}`}
                      >
                        {option.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="px-4 py-3 border-b border-[#ffffff10] space-x-8 flex items-start justify-start h-full">
                <div className="h-full lg:w-[120px] w-[80px] flex items-center justify-end">
                  <div className="py-1.5 text-sm font-medium text-white">Thể loại:</div>
                </div>
                <ul className="flex flex-wrap gap-x-1.5 items-center gap-y-3 w-full">
                  {directoryState.error && !directory && (
                    <li className="w-full">
                      <ErrorState
                        message={errorMessage(directoryState.error)}
                        onRetry={directoryState.reload}
                      />
                    </li>
                  )}
                  {directoryState.loading && !directory && <Loader />}
                  {genres.map((genre) => {
                    const href = paths.genre(genre.slug);
                    return (
                      <li key={genre.slug}>
                        <Link
                          href={href}
                          className={`${optionClass} ${currentPath === href ? selectedClass : ""}`}
                        >
                          {genre.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="px-4 py-3 border-b border-[#ffffff10] space-x-8 flex items-start justify-start h-full">
                <div className="h-full lg:w-[120px] w-[80px] flex items-center justify-end">
                  <div className="py-1.5 text-sm font-medium text-white">Mùa:</div>
                </div>
                <ul className="flex flex-wrap gap-x-1.5 items-center gap-y-3 w-full">
                  {seasons.map((season) => {
                    const href = paths.season(season.slug);
                    return (
                      <li key={season.slug}>
                        <Link
                          href={href}
                          className={`${optionClass} ${currentPath === href ? selectedClass : ""}`}
                        >
                          {season.name}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>

        <div className="my-6 relative min-h-[500px]">
          {catalog.loading && <Loader />}
          {!catalog.loading && catalog.error && (
            <ErrorState message={errorMessage(catalog.error)} onRetry={catalog.reload} />
          )}
          {!catalog.loading && !catalog.error && response && response.items.length === 0 && (
            <EmptyState message="Không có phim nào." />
          )}
          {!catalog.loading && !catalog.error && response && response.items.length > 0 && (
            <>
              <MovieGrid movies={response.items.map(toMovie)} />
              {pagination && (
                <div className="w-full flex items-center justify-center my-20">
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={() => updatePage(pagination.currentPage - 1)}
                      disabled={pagination.currentPage <= 1}
                      className={`h-[50px] w-[50px] rounded-full bg-[#2F3346] flex items-center justify-center ${pagination.currentPage <= 1 ? "opacity-50 cursor-not-allowed" : "hover:bg-primary hover:text-black transition-colors"}`}
                    >
                      <i className="fa-solid fa-arrow-left text-gray-400"></i>
                    </button>

                    <div className="h-[50px] px-8 rounded-full bg-[#2F3346] flex items-center justify-center space-x-1.5">
                      <div className="text-white text-sm">Trang</div>
                      <input
                        className="text-white w-auto text-[13px] text-center px-3 py-1.5 outline-0 rounded-md max-w-[50px] font-bold flex items-center justify-center border border-gray-600 focus:border-gray-500 bg-transparent placeholder:text-[#7a7c81]"
                        max={pagination.totalPages ?? undefined}
                        min={1}
                        type="number"
                        value={pagination.currentPage}
                        onChange={(event) => {
                          const nextPage = Number(event.target.value);
                          if (Number.isInteger(nextPage)) updatePage(nextPage);
                        }}
                      />
                      {pagination.totalPages !== null && (
                        <div className="text-white text-sm">/ {pagination.totalPages}</div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => updatePage(pagination.currentPage + 1)}
                      disabled={!pagination.hasNext}
                      className={`h-[50px] w-[50px] rounded-full bg-[#2F3346] flex items-center justify-center ${!pagination.hasNext ? "opacity-50 cursor-not-allowed" : "hover:bg-primary hover:text-black transition-colors"}`}
                    >
                      <i className="fa-solid fa-arrow-right text-white"></i>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
