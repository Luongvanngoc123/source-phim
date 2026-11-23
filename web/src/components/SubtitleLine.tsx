import type { PropsWithChildren } from "react";
import styles from "./SubtitleLine.module.css";

type SubtitleLineProps = PropsWithChildren<{
  size?: "poster" | "screen";
  as?: "p" | "span";
  live?: boolean;
}>;

export function SubtitleLine({
  size = "screen",
  as: Tag = "p",
  live = false,
  children,
}: SubtitleLineProps) {
  const className = [styles.line, styles[size], "subtitle-line"].join(" ");

  return (
    <Tag
      className={className}
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      {children}
    </Tag>
  );
}
