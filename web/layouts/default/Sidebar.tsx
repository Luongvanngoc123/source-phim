import clsx from "clsx";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { SeasonRef } from "@/types/engine";
import { paths } from "@/lib/paths";

interface DirectoryItem {
  slug: string;
  name: string;
}

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  seasons: SeasonRef[];
  categories: DirectoryItem[];
  countries: DirectoryItem[];
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen, seasons, categories, countries }) => {
  const [openMenu, setOpenMenu] = useState<null | string>(null);
  const toggleMenu = (menu: string) => setOpenMenu((previous) => (previous === menu ? null : menu));

  useEffect(() => {
    // The next time the menu opens it starts with every group folded.
    if (!isOpen) setOpenMenu(null);
  }, [isOpen]);

  return (
    // Shown below the same breakpoint at which the header shows its menu toggle.
    <div className={clsx("fixed z-50 w-full top-[4.5rem] xl:hidden", isOpen ? "flex" : "hidden")}>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => setIsOpen(false)}
        className="fixed inset-0 top-[4.5rem] cursor-default"
      />
      <div
        className="relative max-w-xl w-full bg-[rgba(59,73,135,1)] shadow-xl mx-4 rounded-xl backdrop-blur-[20px] p-4"
        onClick={(event) => {
          // Pages change without a reload, so the menu has to close itself once a link is
          // picked; otherwise it stays on top of the page that was asked for.
          if ((event.target as HTMLElement).closest("a")) setIsOpen(false);
        }}
      >
        <button
          type="button"
          aria-label="Đóng menu"
          onClick={() => setIsOpen(false)}
          className="absolute top-3 right-4 text-white text-xl"
        >
          ×
        </button>
        <ul className="grid grid-cols-2 my-6 gap-5 relative">
          <li>
            <Link
              href={paths.home}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Trang chủ
            </Link>
          </li>
          <li>
            <Link
              href={paths.kkSeries}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Phim bộ
            </Link>
          </li>
          <li>
            <Link
              href={paths.kkMovies}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Phim lẻ
            </Link>
          </li>
          <li>
            <Link
              href={paths.kkAnimation}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Hoạt hình
            </Link>
          </li>
          <li>
            <Link
              href={paths.kkTvShows}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              TV Shows
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={() => toggleMenu("anime")}
              className="flex items-center gap-2 text-white font-semibold text-[13px] hover:text-primary"
            >
              Anime{" "}
              <i
                className={clsx(
                  "fa-solid fa-caret-down transition-transform",
                  openMenu === "anime" && "rotate-180 text-primary",
                )}
              ></i>
            </button>
            {openMenu === "anime" && (
              <div className="absolute left-0 right-0 top-full z-[20] mt-3 rounded-lg bg-[#20284bfa] p-2 shadow-xl">
                <div className="grid grid-cols-2 gap-1">
                  <Link
                    href={paths.animeSeries}
                    className="rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
                  >
                    Anime bộ
                  </Link>
                  <Link
                    href={paths.animeMovies}
                    className="rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
                  >
                    Anime lẻ
                  </Link>
                  <Link
                    href={paths.upcoming}
                    className="rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
                  >
                    Sắp chiếu
                  </Link>
                  <Link
                    href={paths.schedule}
                    className="rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
                  >
                    Lịch chiếu
                  </Link>
                  <Link
                    href={paths.topics}
                    className="rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10"
                  >
                    Chủ đề
                  </Link>
                </div>
                <div className="mt-2 max-h-40 overflow-y-auto border-t border-white/10 pt-2">
                  {seasons.map((season) => (
                    <Link
                      key={season.slug}
                      href={paths.season(season.slug)}
                      className="block rounded px-3 py-1.5 text-[13px] text-gray-300 hover:bg-white/10 hover:text-white"
                    >
                      {season.name}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </li>
          <li>
            <button
              type="button"
              onClick={() => toggleMenu("category")}
              className="flex items-center gap-2 text-white font-semibold text-[13px] hover:text-primary"
            >
              Thể loại{" "}
              <i
                className={clsx(
                  "fa-solid fa-caret-down transition-transform",
                  openMenu === "category" && "rotate-180 text-primary",
                )}
              ></i>
            </button>
            {openMenu === "category" && (
              <div className="absolute left-0 right-0 top-full z-[20] mt-3 max-h-64 overflow-y-auto rounded-lg bg-[#20284bfa] p-2 shadow-xl">
                {categories.map((category) => (
                  <Link
                    key={category.slug}
                    href={paths.category(category.slug)}
                    className="block rounded px-3 py-1.5 text-[13px] text-white hover:bg-white/10 hover:text-primary"
                  >
                    {category.name}
                  </Link>
                ))}
              </div>
            )}
          </li>
          <li>
            <button
              type="button"
              onClick={() => toggleMenu("country")}
              className="flex items-center gap-2 text-white font-semibold text-[13px] hover:text-primary"
            >
              Quốc gia{" "}
              <i
                className={clsx(
                  "fa-solid fa-caret-down transition-transform",
                  openMenu === "country" && "rotate-180 text-primary",
                )}
              ></i>
            </button>
            {openMenu === "country" && (
              <div className="absolute left-0 right-0 top-full z-[20] mt-3 max-h-64 overflow-y-auto rounded-lg bg-[#20284bfa] p-2 shadow-xl">
                {countries.map((country) => (
                  <Link
                    key={country.slug}
                    href={paths.country(country.slug)}
                    className="block rounded px-3 py-1.5 text-[13px] text-gray-300 hover:bg-white/10 hover:text-white"
                  >
                    {country.name}
                  </Link>
                ))}
              </div>
            )}
          </li>
        </ul>
      </div>
    </div>
  );
};

export default Sidebar;
