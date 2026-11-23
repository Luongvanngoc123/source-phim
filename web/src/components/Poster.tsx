import { useState } from "react";
import { SubtitleLine } from "./SubtitleLine";
import styles from "./Poster.module.css";

type PosterProps = {
  src: string;
  title: string;
  caption?: string | null;
  sizes?: string;
  className?: string;
};

export function Poster({
  src,
  title,
  caption = null,
  sizes,
  className,
}: PosterProps) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const showImage = Boolean(src) && src !== failedSource;
  const wrapperClass = [styles.wrap, className].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass}>
      <div className={styles.image}>
        {showImage ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            sizes={sizes}
            onError={() => setFailedSource(src)}
          />
        ) : (
          <span className={styles.fallback}>{title}</span>
        )}
        {caption ? <SubtitleLine size="poster">{caption}</SubtitleLine> : null}
      </div>
    </div>
  );
}
