"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { paths } from "@/lib/paths";

const ProposalGird2: React.FC<{ movies: IMovie[] }> = ({ movies }) => {
  return (
    <div className="relative w-full">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {movies.map((movie) => (
          <div key={movie._id}>
            <Link href={paths.film(movie.slug)} className="group flex h-full flex-col">
              <div className="relative w-full">
                <Image
                  width={300}
                  height={450}
                  src={movie.poster_url}
                  alt={movie.name}
                  loading="lazy"
                  className="aspect-[2/3] w-full rounded-xl object-cover shadow-lg"
                />

                <div className="absolute bottom-0 left-0 z-10 flex w-full justify-center">
                  {movie.lang.map((lang, index) => {
                    const isFirst = index === 0;
                    const classes =
                      lang === 0
                        ? `bg-gray-500 text-white ${isFirst ? "rounded-tl" : "rounded-tr"}`
                        : lang === 1
                          ? `bg-white text-black ${isFirst ? "rounded-tl" : "rounded-tr"}`
                          : lang === 2
                            ? `bg-green-600 text-white ${isFirst ? "rounded-tl" : "rounded-tr"}`
                            : "";
                    if (!classes) {
                      return null;
                    }
                    const label = lang === 0 ? "Phụ đề" : lang === 1 ? "Thuyết Minh" : "Lồng tiếng";
                    return (
                      <span key={`lang-${index}`} className={`px-2 py-1 text-[11px] ${classes}`}>
                        {label}
                      </span>
                    );
                  })}
                </div>
              </div>

              <div className="mt-4 px-4 text-center">
                <h3 className="truncate text-sm font-semibold text-white transition-colors group-hover:text-primary">
                  {movie.name}
                </h3>
                {movie.origin_name && (
                  <p className="mt-1.5 truncate text-xs text-gray-400">{movie.origin_name}</p>
                )}
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ProposalGird2;
