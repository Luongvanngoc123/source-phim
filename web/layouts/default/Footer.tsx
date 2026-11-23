import React from "react";
import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { SITE_DESCRIPTION } from "@/config-global";
import { paths } from "@/lib/paths";

const Footer: React.FC = () => {
  return (
    <>
      <footer className="bg-[#080b1d] px-5 lg:px-6 py-8">
        <div className="flex flex-col items-center lg:items-start justify-center">
          <div className="py-4 flex lg:flex-row flex-col items-center lg:space-x-12">
            <Wordmark className="text-2xl" />
          </div>
          <div className="py-4 flex items-center lg:items-start flex-col justify-center">
            <div className="flex items-center flex-wrap gap-x-6 gap-y-2 mb-3 lg:justify-start justify-center">
              <Link
                href={paths.home}
                className="text-sm text-white hover:text-primary transition-colors"
              >
                Trang chủ
              </Link>
              <Link
                href={paths.series}
                className="text-sm text-white hover:text-primary transition-colors"
              >
                Anime bộ
              </Link>
              <Link
                href={paths.movies}
                className="text-sm text-white hover:text-primary transition-colors"
              >
                Anime lẻ
              </Link>
              <Link
                href={paths.schedule}
                className="text-sm text-white hover:text-primary transition-colors"
              >
                Lịch chiếu
              </Link>
              <Link
                href={paths.genres}
                className="text-sm text-white hover:text-primary transition-colors"
              >
                Chủ đề
              </Link>
            </div>
            <p className="text-sm lg:text-start text-center text-gray-400 leading-relaxed mb-2 max-w-3xl">
              {SITE_DESCRIPTION}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
};

export default Footer;
