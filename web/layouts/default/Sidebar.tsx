import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { FreeMode, Mousewheel } from "swiper/modules";
import type { GenreRef, SeasonRef } from "@/types/engine";
import { paths } from "@/lib/paths";
import "swiper/css";
import "swiper/css/free-mode";

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (value: boolean) => void;
  chunkedGenres: GenreRef[][];
  chunkedSeasons: SeasonRef[][];
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen, chunkedGenres, chunkedSeasons }) => {
  const [openMenu, setOpenMenu] = useState<null | string>(null);
  const [genreSlideIndex, setGenreSlideIndex] = useState(0);
  const [genreTotalSlides, setGenreTotalSlides] = useState(0);
  const [seasonSlideIndex, setSeasonSlideIndex] = useState(0);
  const [seasonTotalSlides, setSeasonTotalSlides] = useState(0);
  const toggleMenu = (menu: string) => setOpenMenu((prev) => (prev === menu ? null : menu));
  return (
    <div className={clsx("fixed z-50 w-full top-[4.5rem] lg:hidden", isOpen ? "flex" : "hidden")}>
      <div className="max-w-xl w-full bg-[rgba(59,73,135,1)] shadow-xl lg:max-w-[23rem] mx-4 lg:mx-8 rounded-xl backdrop-blur-[20px] p-4 flex-col justify-center">
        <button
          onClick={() => setIsOpen(false)}
          className="absolute top-3 right-4 text-white text-xl"
        >
          ×
        </button>
        <ul className="grid grid-cols-2 my-6 gap-6 relative">
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
              href={paths.series}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Anime bộ
            </Link>
          </li>
          <li>
            <Link
              href={paths.movies}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Anime lẻ
            </Link>
          </li>
          <li>
            <Link
              href={paths.upcoming}
              className="text-white hover:text-primary font-semibold text-[13px]"
            >
              Sắp chiếu
            </Link>
          </li>
          <li>
            <button
              onClick={() => toggleMenu("genre")}
              className="text-white font-semibold flex items-center space-x-2 text-[13px] hover:text-primary"
            >
              <span>Thể loại</span>
              <i
                className={clsx(
                  "fa-solid fa-caret-down transition-transform duration-200",
                  openMenu === "genre" ? "rotate-180 text-primary" : "",
                )}
              ></i>
            </button>
            {openMenu === "genre" && (
              <div className="z-[20] absolute translate-y-[10px] bg-[#20284bfa] rounded-lg shadow-[2px_1px_12px_0px_#00000030] p-2 w-[-webkit-fill-available]">
                <div className="flex items-center justify-between p-3 bg-[#fff1]">
                  <div className="flex items-center space-x-2 text-xs">
                    <i className="fa-solid fa-clapperboard text-primary"></i>
                    <span className="font-semibold text-white">TRƯỢT ĐỂ XEM</span>
                  </div>
                  <span className="text-white font-semibold text-xs">
                    {genreTotalSlides > 0 ? `${genreSlideIndex + 1}/${genreTotalSlides}` : "..."}
                  </span>
                </div>
                <Swiper
                  spaceBetween={8}
                  slidesPerView="auto"
                  onSwiper={(swiper) => setGenreTotalSlides(swiper.slides.length)}
                  onSlideChange={(swiper) => setGenreSlideIndex(swiper.activeIndex)}
                >
                  {chunkedGenres.map((columnItems, idx) => (
                    <SwiperSlide key={idx} className="w-auto">
                      <ul className="grid grid-cols-2 gap-4 text-[13px] mt-3">
                        {columnItems.map((item) => (
                          <li key={item.slug}>
                            <Link
                              href={paths.genre(item.slug)}
                              className="flex flex-row py-1.5 px-4 text-white hover:text-primary hover:bg-gray-400/10 rounded-lg h-full items-center justify-start"
                            >
                              {item.name}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </SwiperSlide>
                  ))}
                </Swiper>
              </div>
            )}
          </li>
          <li>
            <button
              onClick={() => toggleMenu("season")}
              className="text-white font-semibold flex items-center space-x-2 text-[13px] hover:text-primary"
            >
              <span>Mùa</span>
              <i
                className={clsx(
                  "fa-solid fa-caret-down transition-transform duration-200",
                  openMenu === "season" ? "rotate-180 text-primary" : "",
                )}
              ></i>
            </button>
            {openMenu === "season" && (
              <div className="z-[20] absolute translate-y-[10px] bg-[#20284bfa] rounded-lg shadow-[2px_1px_12px_0px_#00000030] p-2 w-[-webkit-fill-available] right-0">
                <div className="flex items-center justify-between p-3 bg-[#fff1]">
                  <div className="flex items-center space-x-2 text-xs">
                    <i className="fa-solid fa-clapperboard text-primary"></i>
                    <span className="font-semibold text-white">CUỘN ĐỂ XEM</span>
                  </div>
                  <span className="text-white font-semibold text-xs">
                    {seasonTotalSlides > 0 ? `${seasonSlideIndex + 1}/${seasonTotalSlides}` : "..."}
                  </span>
                </div>
                <div className="my-3 h-[10rem]">
                  <Swiper
                    slidesPerView={"auto"}
                    spaceBetween={8}
                    freeMode={true}
                    modules={[FreeMode, Mousewheel]}
                    mousewheel={true}
                    direction={"vertical"}
                    className="h-full"
                    onSwiper={(swiper) => setSeasonTotalSlides(swiper.slides.length)}
                    onSlideChange={(swiper) => setSeasonSlideIndex(swiper.activeIndex)}
                  >
                    {chunkedSeasons.map((columnItems, idx) => (
                      <SwiperSlide key={idx} className="w-auto h-auto">
                        <ul className="flex flex-col space-y-1 text-[13px]">
                          {columnItems.map((item) => (
                            <li key={item.slug}>
                              <Link
                                href={paths.season(item.slug)}
                                className="flex flex-row py-1.5 px-4 text-white hover:text-primary hover:bg-gray-400/10 rounded-lg whitespace-nowrap"
                              >
                                {item.name}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </SwiperSlide>
                    ))}
                  </Swiper>
                </div>
              </div>
            )}
          </li>
          <li>
            <Link
              href={paths.schedule}
              className="text-white font-semibold hover:text-primary text-[13px]"
            >
              Lịch chiếu
            </Link>
          </li>
          <li>
            <Link
              href={paths.genres}
              className="text-white font-semibold hover:text-primary text-[13px]"
            >
              Chủ đề
            </Link>
          </li>
        </ul>
      </div>
    </div>
  );
};

export default Sidebar;
