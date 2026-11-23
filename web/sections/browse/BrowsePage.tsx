import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import MovieGrid from "@/components/Movie/MovieGird";
import { errorMessage, getGenres } from "@/lib/engine";
import { getCatalogPage, getDirectories } from "@/lib/catalog";
import type { CatalogSpec } from "@/lib/catalog";
import { useAsync } from "@/lib/useAsync";
import { paths } from "@/lib/paths";
import type { GenresResponse } from "@/types/engine";

interface BrowsePageProps {
  title: string;
  seoTitle?: string;
  spec: CatalogSpec | null;
  directory?: GenresResponse;
}

const selectedClass = "border-gray-600 text-primary";
const optionClass =
  "text-sm transition-colors duration-200 border px-3 py-1.5 rounded-lg text-gray-300 border-transparent hover:text-primary";

function pageFromQuery(value: string | string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function queryValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function isKkList(
  spec: CatalogSpec | null,
): spec is Extract<CatalogSpec, { source: "kk"; list: string }> {
  return Boolean(spec && spec.source === "kk" && "list" in spec);
}

export default function BrowsePage({ title, seoTitle, spec, directory }: BrowsePageProps) {
  const router = useRouter();
  const [filter, setFilter] = useState(false);
  const currentPage = pageFromQuery(router.query.page);
  const kk = spec?.source === "kk";
  const directoryState = useAsync(kk ? getDirectories : null, [kk]);
  const animeDirectoryState = useAsync(kk || directory ? null : getGenres, [kk, directory]);
  const genres = directory?.genres ?? animeDirectoryState.data?.genres ?? [];
  const seasons = directory?.seasons ?? animeDirectoryState.data?.seasons ?? [];
  const kkDirectories = directoryState.data;
  const activeSpec = useMemo((): CatalogSpec | null => {
    if (!spec || !isKkList(spec)) {
      return spec;
    }
    const category = queryValue(router.query.category);
    const country = queryValue(router.query.country);
    const yearText = queryValue(router.query.year);
    const year = Number(yearText);
    const langText = queryValue(router.query.lang);
    const sortText = queryValue(router.query.sort);
    return {
      ...spec,
      ...(category ? { category } : {}),
      ...(country ? { country } : {}),
      ...(Number.isInteger(year) && year > 0 ? { year } : {}),
      ...(langText === "vietsub" || langText === "thuyet-minh" || langText === "long-tieng"
        ? { lang: langText }
        : {}),
      ...(sortText === "modified" || sortText === "year" ? { sort: sortText } : {}),
    };
  }, [
    router.query.category,
    router.query.country,
    router.query.lang,
    router.query.sort,
    router.query.year,
    spec,
  ]);
  const catalog = useAsync(
    router.isReady && activeSpec ? () => getCatalogPage(activeSpec, currentPage) : null,
    [activeSpec, currentPage, router.isReady],
  );
  const response = catalog.data;
  const pagination = response?.pagination;
  const currentPath = router.asPath.split("?")[0];

  const updateQuery = (changes: Record<string, string | undefined>) => {
    const query = { ...router.query, ...changes, page: "1" } as Record<
      string,
      string | string[] | undefined
    >;
    Object.keys(query).forEach((key) => {
      if (!query[key]) {
        delete query[key];
      }
    });
    void router.push({ pathname: router.pathname, query }, undefined, {
      shallow: true,
      scroll: false,
    });
  };

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
    { label: "Anime bộ", href: paths.animeSeries },
    { label: "Anime lẻ", href: paths.animeMovies },
    { label: "Sắp chiếu", href: paths.upcoming },
  ];
  const kkList = isKkList(spec);
  const category = queryValue(router.query.category);
  const country = queryValue(router.query.country);
  const year = queryValue(router.query.year);
  const lang = queryValue(router.query.lang);
  const sort = queryValue(router.query.sort);
  const yearOptions = Array.from({ length: 8 }, (_, index) =>
    String(new Date().getFullYear() - index),
  );
  const [yearDraft, setYearDraft] = useState(year);
  useEffect(() => setYearDraft(year), [year]);
  const languageOptions = [
    { label: "Phụ đề", value: "vietsub" },
    { label: "Thuyết minh", value: "thuyet-minh" },
    { label: "Lồng tiếng", value: "long-tieng" },
  ];
  const sortOptions = [
    { label: "Mới cập nhật", value: "modified" },
    { label: "Năm phát hành", value: "year" },
  ];

  if (!spec) {
    return <Loader />;
  }

  return (
    <>
      <NextSeo title={seoTitle ?? title} />
      <div className="pb-28 pt-5 px-5 lg:px-6">
        <div className="text-2xl font-semibold text-white">{title}</div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setFilter((value) => !value)}
            className="inline-flex items-center gap-2 bg-[rgba(var(--bg-body))] py-0 pl-[0.5rem] pr-[0.75rem] h-[30px] text-white cursor-pointer font-medium rounded-[0.3rem]"
          >
            <i className={`fa-solid fa-filter text-xs ${filter ? "text-primary" : ""}`}></i>
            <span className="text-[15px]">Bộ lọc</span>
          </button>

          {filter && (
            <div className="border-1 border rounded-xl border-[#ffffff10] -mt-[15px] mb-12">
              {kk ? (
                <>
                  <FilterRow label="Thể loại">
                    {directoryState.loading && <Loader />}
                    {directoryState.error && (
                      <ErrorState
                        message={errorMessage(directoryState.error)}
                        onRetry={directoryState.reload}
                      />
                    )}
                    {(kkDirectories?.categories ?? []).map((item) => (
                      <FilterButton
                        key={item.slug}
                        label={item.name}
                        active={category === item.slug}
                        onClick={() =>
                          updateQuery({ category: category === item.slug ? undefined : item.slug })
                        }
                      />
                    ))}
                  </FilterRow>
                  <FilterRow label="Quốc gia">
                    {(kkDirectories?.countries ?? []).map((item) => (
                      <FilterButton
                        key={item.slug}
                        label={item.name}
                        active={country === item.slug}
                        onClick={() =>
                          updateQuery({ country: country === item.slug ? undefined : item.slug })
                        }
                      />
                    ))}
                  </FilterRow>
                  <FilterRow label="Năm">
                    {yearOptions.map((value) => (
                      <FilterButton
                        key={value}
                        label={value}
                        active={year === value}
                        onClick={() => updateQuery({ year: year === value ? undefined : value })}
                      />
                    ))}
                    <input
                      value={yearOptions.includes(year) ? "" : yearDraft}
                      onChange={(event) => setYearDraft(event.target.value)}
                      onBlur={() => updateQuery({ year: yearDraft || undefined })}
                      placeholder="Nhập năm"
                      inputMode="numeric"
                      className="w-[108px] rounded-md border border-transparent bg-[#282a33] px-3 py-1.5 text-[13px] text-white outline-0 focus:border-white"
                    />
                  </FilterRow>
                  <FilterRow label="Ngôn ngữ">
                    {languageOptions.map((item) => (
                      <FilterButton
                        key={item.value}
                        label={item.label}
                        active={lang === item.value}
                        onClick={() =>
                          updateQuery({ lang: lang === item.value ? undefined : item.value })
                        }
                      />
                    ))}
                  </FilterRow>
                  <FilterRow label="Sắp xếp">
                    {sortOptions.map((item) => (
                      <FilterButton
                        key={item.value}
                        label={item.label}
                        active={sort === item.value}
                        onClick={() =>
                          updateQuery({ sort: sort === item.value ? undefined : item.value })
                        }
                      />
                    ))}
                  </FilterRow>
                  <div className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setFilter(false)}
                      className="rounded-full border border-gray-500 px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      Đóng
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <FilterRow label="Danh sách">
                    {typeOptions.map((option) => (
                      <Link
                        key={option.href}
                        href={option.href}
                        className={`${optionClass} ${currentPath === option.href ? selectedClass : ""}`}
                      >
                        {option.label}
                      </Link>
                    ))}
                  </FilterRow>
                  <FilterRow label="Chủ đề">
                    {genres.map((genre) => {
                      const href = paths.topic(genre.slug);
                      return (
                        <Link
                          key={genre.slug}
                          href={href}
                          className={`${optionClass} ${currentPath === href ? selectedClass : ""}`}
                        >
                          {genre.name}
                        </Link>
                      );
                    })}
                  </FilterRow>
                  <FilterRow label="Mùa">
                    {seasons.map((season) => {
                      const href = paths.season(season.slug);
                      return (
                        <Link
                          key={season.slug}
                          href={href}
                          className={`${optionClass} ${currentPath === href ? selectedClass : ""}`}
                        >
                          {season.name}
                        </Link>
                      );
                    })}
                  </FilterRow>
                </>
              )}
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
              <MovieGrid movies={response.items} />
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
                        className="text-white w-auto text-[13px] text-center px-3 py-1.5 outline-0 rounded-md max-w-[50px] font-bold flex items-center justify-center border border-gray-600 focus:border-gray-500 bg-transparent"
                        max={pagination.totalPages ?? undefined}
                        min={1}
                        type="number"
                        value={pagination.currentPage}
                        onChange={(event) => {
                          const nextPage = Number(event.target.value);
                          if (Number.isInteger(nextPage)) {
                            updatePage(nextPage);
                          }
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

function FilterRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-[#ffffff10] space-x-8 flex items-start justify-start h-full">
      <div className="h-full lg:w-[120px] w-[80px] flex items-center justify-end shrink-0">
        <div className="py-1.5 text-sm font-medium text-white">{label}:</div>
      </div>
      <ul className="flex flex-wrap gap-x-1.5 items-center gap-y-3 w-full">{children}</ul>
    </div>
  );
}

function FilterButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`${optionClass} ${active ? selectedClass : ""}`}
      >
        {label}
      </button>
    </li>
  );
}
