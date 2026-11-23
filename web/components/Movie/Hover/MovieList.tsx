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
  const screenWidth = typeof window !== "undefined" ? window.innerWidth : 0;
  const cardWidth = 380;
  const hasWideArt = Boolean(movie.thumb_url) && movie.thumb_url !== movie.poster_url;
  const top = position.top - (hasWideArt ? 200 : 110);

  let left = position.left - 200;
  if (left < 0) left = position.left - 100;
  if (left + cardWidth > screenWidth) left = position.left - 350;

  const actionPills = (
    <div className="flex space-x-1.5 mt-3">
      <span className="flex-1 bg-primary text-black text-sm py-2 px-3 rounded-md justify-center font-medium hover:bg-primary transition-colors flex items-center space-x-4">
        <i className="fa-solid fa-play"></i>
        <span>Xem ngay</span>
      </span>
      <span className="flex-1 border font-medium border-gray-400 text-gray-300 text-sm py-2 px-3 rounded-md justify-center transition-colors flex items-center space-x-3">
        <i className="fa-solid fa-circle-info"></i>
        <span>Chi tiết</span>
      </span>
    </div>
  );

  const badgeRow = (
    <div className="flex flex-wrap gap-2 text-xs text-gray-400 mt-3">
      {movie.rating > 0 && (
        <span className="border border-primary text-primary text-[11px] rounded px-1 py-0.5">
          <i className="fa-solid fa-star"></i>{" "}
          <span className="text-white font-medium">{movie.rating.toFixed(1)}</span>
        </span>
      )}

      {movie.quality && (
        <span className="bg-[linear-gradient(220deg,rgb(var(--primary)),rgb(var(--primary-light)/1))] text-black font-bold text-[11px] rounded px-1.5 py-0.5">
          {movie.quality}
        </span>
      )}
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
  );

  const genreLine = (
    <div className="flex items-center flex-wrap mt-1 gap-x-2 text-[12px]">
      {movie.category.slice(0, 4).map((genre, i) => (
        <span key={`${genre.slug}-${i}`} className="flex items-center gap-x-2">
          {i > 0 && (
            <span className="text-gray-400" aria-hidden="true">
              •
            </span>
          )}
          <Link href={genre.href} className="text-[12px] py-1 transition-colors">
            <span className="text-gray-200">
              {(genre?.name || "")
                .replace(/\s*phim\s*/gi, " ")
                .trim()
                .replace(/\s+/g, " ")}
            </span>
          </Link>
        </span>
      ))}
    </div>
  );

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
      {hasWideArt ? (
        <>
          <div className="relative">
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
            {movie.origin_name && (
              <p className="text-xs mt-1 text-primary truncate">{movie.origin_name}</p>
            )}
            {actionPills}
            {badgeRow}
            {genreLine}
          </div>
        </>
      ) : (
        <div className="p-4 flex gap-4">
          <Image
            width={120}
            height={180}
            src={movie.poster_url || movie.thumb_url}
            alt={movie.name}
            loading="lazy"
            className="w-[120px] flex-none aspect-[2/3] rounded-lg object-cover"
          />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold text-white line-clamp-2">{movie.name}</h3>
            {movie.origin_name && (
              <p className="text-xs text-primary truncate">{movie.origin_name}</p>
            )}
            {actionPills}
            {badgeRow}
            {genreLine}
          </div>
        </div>
      )}
    </Link>
  );
}
export default MovieListHover;
