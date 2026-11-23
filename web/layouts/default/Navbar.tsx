import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState, useEffect } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Mousewheel, FreeMode } from "swiper/modules";
import Wordmark from "@/components/Wordmark";
import type { GenreRef, SeasonRef } from "@/types/engine";
import { paths } from "@/lib/paths";
import "swiper/css";
import "swiper/css/free-mode";

interface NavbarProps {
  isScrolled: boolean;
  isSidebarOpen: boolean;
  genres: GenreRef[][];
  seasons: SeasonRef[];
  setIsSidebarOpen: (value: boolean) => void;
}

const Navbar: React.FC<NavbarProps> = ({
  isScrolled,
  isSidebarOpen,
  genres,
  seasons,
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

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const query = new FormData(e.currentTarget).get("q")?.toString().trim();
    if (query) {
      router.push(paths.search(query));
      if (isMobileSearchOpen) handleCloseMobileSearch();
    }
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
          <div className={clsx("xl:hidden items-center", isMobileSearchOpen ? "hidden" : "flex")}>
            <button className="relative w-5 h-5" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
              <span
                className={clsx(
                  "block w-full h-[2px] bg-white absolute left-0 transition-all duration-300 ease-in-out",
                  isSidebarOpen ? "!bg-[#FF6C5D] top-[9px] rotate-45" : "top-0",
                )}
              ></span>
              <span
                className={clsx(
                  "block w-[70%] h-[2px] bg-white absolute left-0 top-[9px] transition-all duration-300 ease-in-out",
                  isSidebarOpen ? "opacity-0" : "opacity-100",
                )}
              ></span>
              <span
                className={clsx(
                  "block w-full h-[2px] bg-white absolute left-0 transition-all duration-300 ease-in-out",
                  isSidebarOpen ? "!bg-[#FF6C5D] top-[9px] -rotate-45" : "top-[18px]",
                )}
              ></span>
            </button>
          </div>
          <div className="xl:!ml-0 flex items-center relative">
            <Wordmark className="text-xl" />
          </div>
          <div className="lg:relative mx-1 lg:mx-0 hidden xl:flex lg:max-w-[21rem] lg:min-w-[21rem] lg:w-full w-auto flex-col items-center group">
            <form onSubmit={handleSearch} className="relative w-full flex items-center">
              <input
                type="text"
                placeholder="Tìm kiếm anime"
                name="q"
                className="text-white lg:max-w-full max-w-[22rem] w-full pl-10 placeholder:text-white h-[2.6rem] flex items-center pr-3 py-3 outline-0 rounded-md border border-transparent focus:border-white bg-[rgba(255,255,255,.08)]"
              />
              <button
                type="submit"
                className="absolute h-[2.6rem] flex items-center px-3 left-0 text-white border-1 outline-0"
              >
                <i className="fa-solid fa-magnifying-glass"></i>
              </button>
            </form>
          </div>
        </div>
        <div className="hidden xl:flex items-center space-x-10">
          <ul className="flex items-center space-x-6">
            <li>
              <Link href={paths.home} className="text-white hover:text-primary text-[13px]">
                Trang chủ
              </Link>
            </li>
            <li>
              <Link href={paths.series} className="text-white hover:text-primary text-[13px]">
                Anime bộ
              </Link>
            </li>
            <li>
              <Link href={paths.movies} className="text-white hover:text-primary text-[13px]">
                Anime lẻ
              </Link>
            </li>
            <li>
              <Link href={paths.upcoming} className="text-white hover:text-primary text-[13px]">
                Sắp chiếu
              </Link>
            </li>
            <li className="relative group">
              <button className="text-white group-hover:text-primary hover:text-primary flex items-center space-x-2 text-[13px]">
                <span>Thể loại</span>
                <i className="fa-solid fa-caret-down"></i>
              </button>
              <div className="hidden z-[20] group-hover:block absolute right-0 top-[35px] h-auto text-base bg-[#20284bfa] rounded-lg md:transform md:translate-x-[(-50%, -50%)] before:content-[''] before:absolute before:right-0 before:top-[-33px] before:p-5 before:w-[80px] w-max shadow-[2px_1px_12px_0px_#00000030] min-w-[170px] p-2">
                <div className="flex flex-row items-start space-x-4">
                  {genres.map((columnItems, columnIndex) => (
                    <ul className="flex flex-col space-y-1 text-[13px]" key={`col-${columnIndex}`}>
                      {columnItems.map((item) => (
                        <li key={item.slug}>
                          <Link
                            href={paths.genre(item.slug)}
                            className="flex flex-row py-1.5 px-4 text-white hover:text-primary hover:bg-gray-400/10 rounded-lg group space-x-3"
                          >
                            <span className="line-clamp-2 text-left">{item.name}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              </div>
            </li>
            <li className="relative group">
              <button className="text-white hover:text-primary group-hover:text-primary flex items-center space-x-2 text-[13px]">
                <span>Mùa</span>
                <i className="fa-solid fa-caret-down"></i>
              </button>
              <div className="hidden z-[20] group-hover:block absolute right-0 top-[35px] h-auto text-base bg-[#20284bfa] rounded-lg md:transform md:translate-x-[(-50%, -50%)] before:content-[''] before:absolute before:right-0 before:top-[-33px] before:p-5 before:w-[80px] w-max shadow-[2px_1px_12px_0px_#00000030] min-w-[170px] p-2">
                <Swiper
                  direction={"vertical"}
                  slidesPerView={"auto"}
                  freeMode={true}
                  mousewheel={true}
                  modules={[FreeMode, Mousewheel]}
                  className="h-[80vh] w-full"
                >
                  <SwiperSlide className="!h-auto">
                    <div className="flex flex-row items-start gap-5 px-1.5">
                      <ul className="flex flex-col space-y-2 max-w-[10rem]">
                        {seasons.map((item) => (
                          <li key={item.slug}>
                            <Link
                              href={paths.season(item.slug)}
                              className="block py-1.5 px-3 text-gray-300 hover:text-white hover:bg-white/10 rounded-md transition-colors text-[13px] font-medium"
                            >
                              {item.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </SwiperSlide>
                </Swiper>
              </div>
            </li>
            <li>
              <Link href={paths.schedule} className="text-white hover:text-primary text-[13px]">
                Lịch chiếu
              </Link>
            </li>
            <li>
              <Link href={paths.genres} className="text-white hover:text-primary text-[13px]">
                Chủ đề
              </Link>
            </li>
          </ul>
        </div>
        <form
          onSubmit={handleSearch}
          className={clsx(
            "absolute top-0 left-0 w-full h-full pl-3 pr-14 xl:hidden items-center bg-bg-body",
            isMobileSearchOpen ? "flex" : "hidden",
          )}
        >
          <input
            type="text"
            name="q"
            placeholder="Tìm kiếm anime"
            className="w-full h-[2.8rem] leading-8 py-[.4rem] px-12 bg-[rgba(255,255,255,.08)] text-white text-base !outline-none !shadow-none rounded-[.4rem] !border !border-transparent"
          />
        </form>
        <div className={clsx("xl:hidden", isMobileSearchOpen ? "absolute right-5" : "hidden")}>
          <button className="text-white" onClick={handleCloseMobileSearch}>
            <div className="w-5 h-5 leading-5 text-center relative">
              <span
                className={clsx(
                  "absolute left-0 transition-all duration-300 ease-in-out w-full h-[2px]",
                  isAnimated
                    ? "!bg-[#FF6C5D] top-[9px] rotate-45 opacity-100"
                    : "top-0 opacity-0 bg-white",
                )}
              ></span>
              <span
                className={clsx(
                  "absolute left-0 transition-all duration-300 ease-in-out w-full h-[2px]",
                  isAnimated
                    ? "!bg-[#FF6C5D] top-[9px] -rotate-45 opacity-100"
                    : "top-[15px] opacity-0 bg-white",
                )}
              ></span>
            </div>
          </button>
        </div>
        <div className={clsx("xl:hidden", isMobileSearchOpen ? "absolute left-7" : "flex")}>
          <button onClick={() => setIsMobileSearchOpen(true)} className="text-white text-lg">
            <i className="fa-solid fa-magnifying-glass"></i>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Navbar;
