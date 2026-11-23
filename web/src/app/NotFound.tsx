import { Link } from "react-router";
import { usePageTitle } from "./usePageTitle";
import { paths } from "./paths";
import styles from "./NotFound.module.css";

export function NotFound() {
  usePageTitle("Không có trang này");

  return (
    <section className={styles.page}>
      <h1>Không có trang này.</h1>
      <Link to={paths.home()}>Về trang chủ</Link>
    </section>
  );
}
