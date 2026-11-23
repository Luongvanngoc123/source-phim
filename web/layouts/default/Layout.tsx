import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { getGenres } from "@/lib/engine";
import { getDirectories } from "@/lib/catalog";
import { useAsync } from "@/lib/useAsync";

const Navbar = dynamic(() => import("@/layouts/default/Navbar"), { ssr: false });
const Sidebar = dynamic(() => import("@/layouts/default/Sidebar"), { ssr: false });

const Layout: React.FC<{ children: ReactNode }> = ({ children }) => {
  const genreResponse = useAsync(getGenres, []);
  const directoryResponse = useAsync(getDirectories, []);
  const [isScrolled, setIsScrolled] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const seasons = genreResponse.data?.seasons ?? [];
  const categories = directoryResponse.data?.categories ?? [];
  const countries = directoryResponse.data?.countries ?? [];

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
        seasons={seasons}
        categories={categories}
        countries={countries}
      />
      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        seasons={seasons}
        categories={categories}
        countries={countries}
      />
      <main>{children}</main>
    </>
  );
};

export default Layout;
