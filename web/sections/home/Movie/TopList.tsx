import React from "react";
import dynamic from "next/dynamic";
import { paths } from "@/lib/paths";

const TopList = dynamic(() => import("@/components/home/TopList"), {
  ssr: false,
});

const TopLists: React.FC<{ movies: IMovie[] }> = ({ movies }) => {
  const items = movies.map((movie, index) => ({
    id: movie._id || movie.slug || index,
    title: movie.name,
    href: paths.film(movie.slug),
    thumb: movie.poster_url || movie.thumb_url,
    trend: "none",
  }));

  return (
    <div className="col-span-2">
      <div className="p-6">
        <div className="flex items-center space-x-2 text-[16px]">
          <i className="fa-solid fa-clapperboard text-primary" />
          <span className="font-semibold text-white">NỔI BẬT TRÊN TRANG CHỦ</span>
        </div>
        <div className="mt-6">
          <TopList items={items} limit={5} />
        </div>
      </div>
    </div>
  );
};

export default TopLists;
