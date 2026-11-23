import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { BrandMark } from "./BrandMark";
import { LightsToggle } from "./LightsToggle";
import { paths } from "./paths";
import { SearchBox } from "./SearchBox";
import styles from "./Layout.module.css";

const navigation = [
  ["Lịch chiếu", paths.schedule()],
  ["Anime bộ", paths.catalog("series")],
  ["Anime lẻ", paths.catalog("movies")],
  ["Sắp chiếu", paths.catalog("upcoming")],
  ["Thể loại", paths.genres()],
] as const;

export function Layout() {
  const location = useLocation();
  const previousLocation = useRef<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const routeLocation = `${location.pathname}${location.search}`;
    const shouldFocus =
      previousLocation.current !== null &&
      previousLocation.current !== routeLocation;
    previousLocation.current = routeLocation;
    const frame = window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("#main-content h1");
      if (!heading) {
        return;
      }
      heading.tabIndex = -1;
      if (shouldFocus) {
        heading.focus({ preventScroll: true });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        Bỏ qua, tới nội dung
      </a>
      <header className={styles.header}>
        <div className={styles.bar}>
          <BrandMark />
          <nav
            className={`${styles.nav} ${menuOpen ? styles.navOpen : ""}`}
            id="primary-navigation"
            aria-label="Điều hướng chính"
          >
            {navigation.map(([label, to]) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  isActive ? styles.navLinkActive : styles.navLink
                }
                onClick={() => setMenuOpen(false)}
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <SearchBox key={location.key} />
          <LightsToggle />
          <button
            className={styles.menuButton}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="primary-navigation"
            onClick={() => setMenuOpen((current) => !current)}
          >
            {menuOpen ? "Đóng" : "Menu"}
          </button>
        </div>
      </header>
      <main id="main-content" className="content-column page-main">
        <Outlet />
      </main>
      <footer className={styles.footer}>
        <div className={`${styles.footerContent} content-column`}>
          <BrandMark />
          <nav aria-label="Điều hướng cuối trang">
            {navigation.map(([label, to]) => (
              <NavLink key={to} to={to}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </footer>
      <ScrollRestoration />
    </>
  );
}
