import styles from "./Rating.module.css";

type RatingProps = {
  value: string | null;
};

export function Rating({ value }: RatingProps) {
  if (!value) {
    return null;
  }
  return <span className={styles.rating}>{value}</span>;
}
