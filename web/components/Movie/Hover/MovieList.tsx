"use client";

import "swiper/css";
import "swiper/css/navigation";
import Image from "next/image";
import Link from "next/link";
import { paths } from "@/lib/paths";
import { episodeLabel } from "@/lib/adapter";

interface Position {
  top: number;
  left: number;
}

interface MovieListHoverProps {
  movie: IMovie;
  position: Position;
  isVisible: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

function MovieListHover({
  movie,
  position,
  isVisible,
  onMouseEnter,
  onMouseLeave,
}: MovieListHoverProps) {
  // Kiểm tra window để tránh lỗi SSR
  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const cardWidth = 380; // width của card

  // Tính toán vị trí hiển thị
  let left = position.left - 200;
  const top = position.top - 200;

  // Điều chỉnh nếu tràn màn hình
  if (left < 0) left = position.left - 100;
  if (left + cardWidth > screenWidth) left = position.left - 350;

  const cardStyle = {
    position: "absolute" as const,
    top: `${top}px`,
    left: `${left}px`,
    zIndex: 50,
  };

  return (
    <Link
      href={paths.film(movie.slug)}
      style={cardStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}

      className={`
                w-[430px] animate-qtip bg-[#2F3346] rounded-xl shadow-xl overflow-hidden
                transform-gpu transition-all duration-200 ease-in-out 
                ${
                  isVisible
                    ? "opacity-100 scale-100 translate-y-0"
                    : "opacity-0 scale-95 translate-y-2 pointer-events-none"
                }
            `}
    >
      <div className="relative  ">
        {/* List items only carry a vertical poster; the frame keeps the reference's wide crop. */}
        <Image
          width={550}
          height={197}
          src={movie.thumb_url}
          alt={movie.name}
          loading="lazy"
          className="w-full aspect-[550/197] object-cover"
        />
        <div
          className="h-full w-full left-0 z-[1] absolute bottom-[-5px]
    bg-[linear-gradient(0deg,rgba(47,51,70,1)_0%,rgba(47,51,70,0.95)_10%,rgba(47,51,70,0.7)_25%,rgba(47,51,70,0)_40%,rgba(47,51,70,0)_100%)]"
        />
      </div>
      <div className="px-4 pb-6">
        <h3 className="text-[15px] font-semibold truncate text-white">{movie.name}</h3>
        {movie.origin_name && <p className="text-xs mt-1 text-primary">{movie.origin_name}</p>}
        <div className="flex space-x-1.5 mt-3">
          <span className="flex-1 bg-primary text-black text-sm  py-2.5 px-3 rounded-md justify-center font-medium hover:bg-primary transition-colors flex items-center space-x-4">
            <i className="fa-solid fa-play"></i>
            <span>Xem ngay</span>
          </span>
          <span className="flex-1 border font-medium border-gray-400 text-gray-300 text-sm  py-2.5 px-3 rounded-md justify-center transition-colors flex items-center space-x-3">
            <i className="fa-solid fa-circle-info"></i>
            <span>Chi tiết</span>
          </span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-gray-400 mt-6 ">
          {movie.rating > 0 && (
            <span className="border border-primary text-primary text-[11px] rounded px-1 py-0.5">
              <i className="fa-solid fa-star"></i>{" "}
              <span className="text-white font-medium">{movie.rating.toFixed(1)}</span>
            </span>
          )}

          <span className="bg-[linear-gradient(220deg,rgb(var(--primary)),rgb(var(--primary-light)/1))] text-black font-bold text-[11px] rounded px-1.5 py-0.5">
            {movie.quality}
          </span>
          {episodeLabel(movie) && (
            <span className="bg-white font-medium text-black text-[11px] rounded px-1.5 py-0.5">
              {episodeLabel(movie)}
            </span>
          )}

          {movie.year > 0 && (
            <span className="bg-[#ffffff10] text-gray-300 text-[11px] rounded px-1.5 py-0.5">
              {movie.year}
            </span>
          )}
        </div>

        <div className="flex items-center mt-1 space-x-2 text-[12px]">
          {movie.category.map((genre, i) => (
            <>
              {i > 0 && (
                <span className="text-gray-400" aria-hidden="true">
                  •
                </span>
              )}
              <Link
                href={genre.href}
                key={genre.slug}
                className="text-[12px] space-x-2 py-1 transition-colors"
              >
                <span className="text-gray-200">
                  {(genre?.name || "")
                    .replace(/\s*phim\s*/gi, " ")
                    .trim()
                    .replace(/\s+/g, " ")}
                </span>
              </Link>
            </>
          ))}
        </div>
      </div>
    </Link>
  );
}
export default MovieListHover;
