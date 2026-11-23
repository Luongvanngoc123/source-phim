import { useSearchParams } from "react-router";
import { usePageTitle } from "../../app/usePageTitle";
import styles from "./SearchPage.module.css";
import { SearchResults } from "./SearchResults";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q")?.trim() ?? "";
  usePageTitle(query ? `Tìm “${query}”` : "Tìm kiếm");

  return (
    <section className={styles.page}>
      <h1>{query ? `Kết quả cho “${query}”` : "Tìm kiếm"}</h1>
      {query ? (
        <SearchResults queryText={query} />
      ) : (
        <p className={styles.invitation}>Gõ tên anime vào ô tìm kiếm ở trên.</p>
      )}
    </section>
  );
}
