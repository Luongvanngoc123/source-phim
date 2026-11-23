import { useState, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { getGenres } from "@/lib/engine";
import { useAsync } from "@/lib/useAsync";
import type { GenreRef, SeasonRef } from "@/types/engine";

const Navbar = dynamic(() => import("@/layouts/default/Navbar"), { ssr: false });
const Sidebar = dynamic(() => import("@/layouts/default/Sidebar"), { ssr: false });

const chunkArray = <T,>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const Layout: React.FC<{ children: ReactNode }> = ({ children }) => {
  const genreResponse = useAsync(() => getGenres(), []);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const genres = genreResponse.data?.genres ?? [];
  const seasons = genreResponse.data?.seasons ?? [];

  const chunkedGenresDesktop = useMemo(
    () => (genres.length ? chunkArray<GenreRef>(genres, Math.ceil(genres.length / 3)) : []),
    [genres],
  );
  const chunkedGenresMobile = useMemo(() => chunkArray<GenreRef>(genres, 10), [genres]);
  const chunkedSeasonsMobile = useMemo(() => chunkArray<SeasonRef>(seasons, 5), [seasons]);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 0);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <>
      <Navbar
        isScrolled={isScrolled}
        isSidebarOpen={isSidebarOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        genres={chunkedGenresDesktop}
        seasons={seasons}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        chunkedGenres={chunkedGenresMobile}
        chunkedSeasons={chunkedSeasonsMobile}
      />
      <main>{children}</main>
    </>
  );
};

export default Layout;
