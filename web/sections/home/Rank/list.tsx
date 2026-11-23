import React from "react";
import dynamic from "next/dynamic";

const TopList = dynamic(() => import("@/sections/home/Movie/TopList"), {
  ssr: false,
});

const HomePage: React.FC<{ movies: IMovie[] }> = ({ movies }) => (
  <div className="rounded-xl mt-8 lg:mt-12 border border-white/15">
    <div className="grid grid-cols-2 lg:grid-cols-6 xl:grid-cols-7 gap-4">
      <TopList movies={movies} />
    </div>
  </div>
);

export default HomePage;
