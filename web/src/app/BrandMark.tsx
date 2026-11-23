import { Link } from "react-router";
import { paths } from "./paths";
import styles from "./BrandMark.module.css";

export function BrandMark() {
  return (
    <Link
      className={styles.brand}
      to={paths.home()}
      aria-label="Animora trang chủ"
    >
      <span aria-hidden="true">animora</span>
    </Link>
  );
}
