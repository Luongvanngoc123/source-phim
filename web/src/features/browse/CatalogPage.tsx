import { NavLink, useSearchParams } from "react-router";
import { useCatalog } from "../../api/queries";
import type { CatalogKind } from "../../app/paths";
import { paths } from "../../app/paths";
import { usePageTitle } from "../../app/usePageTitle";
import { ListingLayout } from "./ListingLayout";
import styles from "./CatalogPage.module.css";

type CatalogPageProps = {
  kind: CatalogKind;
  title: string;
};

const catalogLinks: Array<{ kind: CatalogKind; label: string }> = [
  { kind: "series", label: "Anime bộ" },
  { kind: "movies", label: "Anime lẻ" },
  { kind: "upcoming", label: "Sắp chiếu" },
];

function pageFromParams(params: URLSearchParams): number {
  const page = Number(params.get("trang"));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function CatalogPage({ kind, title }: CatalogPageProps) {
  const [searchParams] = useSearchParams();
  const page = pageFromParams(searchParams);
  const query = useCatalog(kind, page);
  const pageTitle = page > 1 ? `${title}, trang ${page}` : title;
  usePageTitle(pageTitle);

  return (
    <section className={styles.page}>
      <h1>{title}</h1>
      <nav className={styles.switcher} aria-label="Chọn danh mục">
        {catalogLinks.map((link) => (
          <NavLink
            key={link.kind}
            to={paths.catalog(link.kind)}
            className={({ isActive }) =>
              isActive ? styles.current : undefined
            }
            end
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
      <ListingLayout
        items={query.data?.items}
        isFetching={query.isFetching}
        isError={query.isError}
        onRetry={() => void query.refetch()}
        page={page}
        hasNext={(query.data?.count ?? 0) === 30}
        hrefFor={(nextPage) => paths.catalog(kind, nextPage)}
        emptyTitle="Chưa có anime trong danh mục này."
      />
    </section>
  );
}
