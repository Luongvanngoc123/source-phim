import { Link } from "react-router";
import styles from "./Pager.module.css";

type PagerProps = {
  page: number;
  hasNext: boolean;
  hrefFor: (page: number) => string;
};

export function Pager({ page, hasNext, hrefFor }: PagerProps) {
  const previousPage = page > 1 ? page - 1 : null;
  const nextPage = hasNext ? page + 1 : null;

  return (
    <nav className={styles.pager} aria-label="Phân trang">
      {previousPage ? (
        <Link to={hrefFor(previousPage)} rel="prev">
          Trang trước
        </Link>
      ) : (
        <span className={styles.unavailable}>Trang trước</span>
      )}
      <strong className="font-figure" aria-current="page">
        {page}
      </strong>
      {nextPage ? (
        <Link to={hrefFor(nextPage)} rel="next">
          Trang sau
        </Link>
      ) : (
        <span className={styles.unavailable}>Trang sau</span>
      )}
    </nav>
  );
}
