import React from "react";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { SITE_DESCRIPTION } from "@/config-global";
import { paths } from "@/lib/paths";

const Footer: React.FC = () => {
  return (
    <footer className="bg-[#080b1d] px-5 py-8 lg:px-6">
      <div className="flex flex-col items-center justify-center lg:items-start">
        <div className="flex flex-col items-center py-4 lg:flex-row lg:space-x-12">
          <Wordmark className="text-2xl" />
        </div>
        <div className="flex flex-col items-center justify-center py-4 lg:items-start">
          <div className="mb-3 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 lg:justify-start">
            <Link
              href={paths.home}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Trang chủ
            </Link>
            <Link
              href={paths.kkSeries}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Phim bộ
            </Link>
            <Link
              href={paths.kkMovies}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Phim lẻ
            </Link>
            <Link
              href={paths.kkAnimation}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Hoạt hình
            </Link>
            <Link
              href={paths.kkTvShows}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              TV Shows
            </Link>
            <Link
              href={paths.animeSeries}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Anime bộ
            </Link>
            <Link
              href={paths.animeMovies}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Anime lẻ
            </Link>
            <Link
              href={paths.schedule}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Lịch chiếu
            </Link>
            <Link
              href={paths.topics}
              className="text-sm text-white transition-colors hover:text-primary"
            >
              Chủ đề
            </Link>
          </div>
          <p className="mb-2 max-w-3xl text-center text-sm leading-relaxed text-gray-400 lg:text-start">
            {SITE_DESCRIPTION}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
