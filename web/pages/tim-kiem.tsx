"use client";

import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import MovieGrid from "@/components/Movie/MovieGird";
import { errorMessage } from "@/lib/engine";
import { searchFilms } from "@/lib/catalog";
import { useAsync } from "@/lib/useAsync";
import { paths } from "@/lib/paths";

function pageFromQuery(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export default function TimKiem() {
  const router = useRouter();
  const query = typeof router.query.q === "string" ? router.query.q.trim() : "";

  return (
    <>
      <NextSeo title={query ? `Tìm kiếm: ${query}` : "Tìm kiếm"} />
      {!router.isReady || !query ? (
        <div className="pb-28 pt-5 px-5 lg:px-6">
          <EmptyState message="Nhập từ khóa để tìm kiếm." />
        </div>
      ) : (
        <div className="pb-28 pt-5 px-5 lg:px-6">
          <h1 className="text-2xl font-semibold text-white">Tìm kiếm: {query}</h1>
          <div className="mt-10 space-y-14">
            <SearchGroup source="kk" query={query} pageKey="kkPage" title="Phim" />
            <SearchGroup source="avs" query={query} pageKey="animePage" title="Anime" />
          </div>
        </div>
      )}
    </>
  );
}

function SearchGroup({
  source,
  query,
  pageKey,
  title,
}: {
  source: FilmSource;
  query: string;
  pageKey: "kkPage" | "animePage";
  title: string;
}) {
  const router = useRouter();
  const page = pageFromQuery(router.query[pageKey]);
  const result = useAsync(router.isReady ? () => searchFilms(source, query, page) : null, [
    page,
    query,
    router.isReady,
    source,
  ]);
  const pagination = result.data?.pagination;

  const updatePage = (nextPage: number) => {
    if (nextPage < 1 || (pagination?.totalPages && nextPage > pagination.totalPages)) {
      return;
    }
    void router.push(
      {
        pathname: paths.search(query).split("?")[0],
        query: { ...router.query, [pageKey]: String(nextPage) },
      },
      undefined,
      { shallow: true, scroll: false },
    );
  };

  return (
    <section>
      <h2 className="mb-5 text-xl font-semibold text-white">{title}</h2>
      {result.loading && <Loader />}
      {!result.loading && result.error && (
        <ErrorState message={errorMessage(result.error)} onRetry={result.reload} />
      )}
      {!result.loading && !result.error && result.data?.items.length === 0 && (
        <EmptyState message={`Không tìm thấy ${title.toLowerCase()} phù hợp.`} />
      )}
      {!result.loading && !result.error && result.data && result.data.items.length > 0 && (
        <>
          <MovieGrid movies={result.data.items} />
          {pagination && (
            <div className="my-16 flex w-full items-center justify-center">
              <div className="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => updatePage(page - 1)}
                  disabled={page <= 1}
                  className={`flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#2F3346] ${page <= 1 ? "cursor-not-allowed opacity-50" : "transition-colors hover:bg-primary hover:text-black"}`}
                >
                  <i className="fa-solid fa-arrow-left text-gray-400"></i>
                </button>
                <div className="flex h-[50px] items-center justify-center space-x-1.5 rounded-full bg-[#2F3346] px-8">
                  <span className="text-sm text-white">Trang</span>
                  <input
                    type="number"
                    min={1}
                    max={pagination.totalPages ?? undefined}
                    value={page}
                    onChange={(event) => {
                      const nextPage = Number(event.target.value);
                      if (Number.isInteger(nextPage)) {
                        updatePage(nextPage);
                      }
                    }}
                    className="max-w-[50px] rounded-md border border-gray-600 bg-transparent px-3 py-1.5 text-center text-[13px] font-bold text-white outline-0"
                  />
                  {pagination.totalPages !== null && (
                    <span className="text-sm text-white">/ {pagination.totalPages}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => updatePage(page + 1)}
                  disabled={!pagination.hasNext}
                  className={`flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#2F3346] ${!pagination.hasNext ? "cursor-not-allowed opacity-50" : "transition-colors hover:bg-primary hover:text-black"}`}
                >
                  <i className="fa-solid fa-arrow-right text-white"></i>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
