import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import Wordmark from "@/components/Wordmark";
import AccountButton from "@/components/Account/AccountButton";
import SearchBox from "@/components/search/SearchBox";
import type { SeasonRef } from "@/types/engine";
import { paths } from "@/lib/paths";

interface DirectoryItem {
  slug: string;
  name: string;
}

interface NavbarProps {
  isScrolled: boolean;
  isSidebarOpen: boolean;
  seasons: SeasonRef[];
  categories: DirectoryItem[];
  countries: DirectoryItem[];
  setIsSidebarOpen: (value: boolean) => void;
}

const menuClass = "text-white hover:text-primary text-[13px] whitespace-nowrap";
const dropdownClass =
  "absolute right-0 top-[35px] z-[60] hidden max-w-[calc(100vw-2rem)] rounded-lg bg-[#20284bfa] p-2 text-base shadow-[2px_1px_12px_0px_#00000030] group-hover:block";

const Navbar: React.FC<NavbarProps> = ({
  isScrolled,
  isSidebarOpen,
  seasons,
  categories,
  countries,
  setIsSidebarOpen,
}) => {
  const router = useRouter();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isAnimated, setIsAnimated] = useState(false);

  useEffect(() => {
    if (isMobileSearchOpen) {
      setIsAnimated(false);
      const timer = setTimeout(() => setIsAnimated(true), 10);
      return () => clearTimeout(timer);
    }
  }, [isMobileSearchOpen]);

  const handleCloseMobileSearch = () => {
    setIsAnimated(false);
    setTimeout(() => setIsMobileSearchOpen(false), 300);
  };

  return (
    <div
      className={clsx(
        "flex top-0 z-50 w-full transition-all duration-100 flex-col items-center",
        router.pathname === "/" || router.pathname === "/phim/[slug]"
          ? "sticky lg:fixed"
          : "sticky",
        isScrolled ? "bg-[#080B1Dd4]" : "bg-transparent",
      )}
    >
      <div
        className={clsx(
          "px-5 lg:px-6 w-full flex justify-between items-center transition-all duration-100",
          isScrolled ? "h-[4.3rem]" : "h-[5rem] md:h-[5.6rem]",
        )}
      >
        <div
          className={clsx(
            "flex items-center space-x-5 xl:flex",
            isMobileSearchOpen ? "hidden" : "flex",
          )}
        >
          <div className="xl:hidden items-center">
            <button
              type="button"
              aria-label={isSidebarOpen ? "Đóng menu" : "Mở menu"}
              className="relative h-5 w-5"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <span
                className={clsx(
                  "absolute left-0 block h-[2px] w-full bg-white transition-all duration-300",
                  isSidebarOpen ? "!bg-[#FF6C5D] top-[9px] rotate-45" : "top-0",
                )}
              ></span>
              <span
                className={clsx(
                  "absolute left-0 top-[9px] block h-[2px] w-[70%] bg-white transition-all duration-300",
                  isSidebarOpen ? "opacity-0" : "opacity-100",
                )}
              ></span>
              <span
                className={clsx(
                  "absolute left-0 block h-[2px] w-full bg-white transition-all duration-300",
                  isSidebarOpen ? "!bg-[#FF6C5D] top-[9px] -rotate-45" : "top-[18px]",
                )}
              ></span>
            </button>
          </div>
          <div className="xl:!ml-0 flex items-center relative">
            <Wordmark className="text-xl" />
          </div>
          <SearchBox className="mx-1 hidden min-w-[21rem] max-w-[21rem] xl:flex" />
        </div>

        <div className="hidden min-w-0 flex-1 items-center justify-end gap-5 xl:flex">
          <ul className="flex min-w-0 items-center gap-4">
            <li>
              <Link href={paths.home} className={menuClass}>
                Trang chủ
              </Link>
            </li>
            <li>
              <Link href={paths.kkSeries} className={menuClass}>
                Phim bộ
              </Link>
            </li>
            <li>
              <Link href={paths.kkMovies} className={menuClass}>
                Phim lẻ
              </Link>
            </li>
            <li>
              <Link href={paths.kkAnimation} className={menuClass}>
                Hoạt hình
              </Link>
            </li>
            <li>
              <Link href={paths.kkTvShows} className={menuClass}>
                TV Shows
              </Link>
            </li>
            <li className="group relative">
              <button type="button" className={`${menuClass} flex items-center gap-1`}>
                Anime <i className="fa-solid fa-caret-down"></i>
              </button>
              <div className={`${dropdownClass} min-w-[210px]`}>
                <ul className="grid grid-cols-2 gap-1 text-[13px]">
                  <li>
                    <Link
                      href={paths.animeSeries}
                      className="block rounded px-3 py-1.5 text-white hover:bg-white/10 hover:text-primary"
                    >
                      Anime bộ
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={paths.animeMovies}
                      className="block rounded px-3 py-1.5 text-white hover:bg-white/10 hover:text-primary"
                    >
                      Anime lẻ
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={paths.upcoming}
                      className="block rounded px-3 py-1.5 text-white hover:bg-white/10 hover:text-primary"
                    >
                      Sắp chiếu
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={paths.schedule}
                      className="block rounded px-3 py-1.5 text-white hover:bg-white/10 hover:text-primary"
                    >
                      Lịch chiếu
                    </Link>
                  </li>
                  <li>
                    <Link
                      href={paths.topics}
                      className="block rounded px-3 py-1.5 text-white hover:bg-white/10 hover:text-primary"
                    >
                      Chủ đề
                    </Link>
                  </li>
                </ul>
                <div className="mt-2 border-t border-white/10 pt-2">
                  <div className="px-3 pb-1 text-xs text-gray-400">Mùa</div>
                  <ul className="grid max-h-[16rem] grid-cols-2 gap-1 overflow-y-auto">
                    {seasons.map((season) => (
                      <li key={season.slug}>
                        <Link
                          href={paths.season(season.slug)}
                          className="block rounded px-3 py-1.5 text-[13px] text-gray-300 hover:bg-white/10 hover:text-white"
                        >
                          {season.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
            <li className="group relative">
              <button type="button" className={`${menuClass} flex items-center gap-1`}>
                Thể loại <i className="fa-solid fa-caret-down"></i>
              </button>
              <div className={`${dropdownClass} min-w-[380px]`}>
                <ul className="grid max-h-[24rem] grid-cols-3 gap-1 overflow-y-auto">
                  {categories.map((category) => (
                    <li key={category.slug}>
                      <Link
                        href={paths.category(category.slug)}
                        className="block rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10 hover:text-primary"
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
            <li className="group relative">
              <button type="button" className={`${menuClass} flex items-center gap-1`}>
                Quốc gia <i className="fa-solid fa-caret-down"></i>
              </button>
              <div className={`${dropdownClass} min-w-[190px]`}>
                <ul className="grid max-h-[24rem] grid-cols-1 gap-1 overflow-y-auto">
                  {countries.map((country) => (
                    <li key={country.slug}>
                      <Link
                        href={paths.country(country.slug)}
                        className="block rounded px-3 py-1.5 text-[13px] text-gray-300 hover:bg-white/10 hover:text-white"
                      >
                        {country.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          </ul>
          <AccountButton />
        </div>

        <div
          className={clsx(
            "absolute top-0 left-0 h-full w-full bg-bg-body px-3 pr-14 xl:hidden items-center",
            isMobileSearchOpen ? "flex" : "hidden",
          )}
        >
          <SearchBox className="w-full" />
        </div>
        <div className={clsx("xl:hidden", isMobileSearchOpen ? "absolute right-5" : "hidden")}>
          <button
            type="button"
            aria-label="Đóng tìm kiếm"
            className="text-white"
            onClick={handleCloseMobileSearch}
          >
            <span className={clsx("relative block h-5 w-5", isAnimated ? "" : "opacity-0")}>
              <span className="absolute left-0 top-[9px] block h-[2px] w-full rotate-45 bg-[#FF6C5D]"></span>
              <span className="absolute left-0 top-[9px] block h-[2px] w-full -rotate-45 bg-[#FF6C5D]"></span>
            </span>
          </button>
        </div>
        <div className={clsx("xl:hidden", isMobileSearchOpen ? "absolute left-7" : "flex")}>
          <button
            type="button"
            aria-label="Mở tìm kiếm"
            onClick={() => setIsMobileSearchOpen(true)}
            className="text-lg text-white"
          >
            <i className="fa-solid fa-magnifying-glass"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Navbar;
