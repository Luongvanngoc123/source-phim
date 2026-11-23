import { Link } from "react-router";
import styles from "./SectionHeading.module.css";

type SectionHeadingProps = {
  title: string;
  action?: { label: string; to: string };
  level?: 2 | 3;
};

export function SectionHeading({
  title,
  action,
  level = 2,
}: SectionHeadingProps) {
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <div className={styles.heading}>
      <Heading>{title}</Heading>
      {action ? <Link to={action.to}>{action.label}</Link> : null}
    </div>
  );
}
