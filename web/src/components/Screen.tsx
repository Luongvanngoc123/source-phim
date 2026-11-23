import { useState } from "react";
import type { CSSProperties, PropsWithChildren } from "react";
import styles from "./Screen.module.css";

type ScreenProps = PropsWithChildren<{
  ratio?: string;
  image?: string | null;
  fit?: "cover" | "contain";
  alt?: string;
  className?: string;
}>;

export function Screen({
  ratio = "16 / 9",
  image,
  fit = "cover",
  alt = "",
  className,
  children,
}: ScreenProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const hasImage = Boolean(image) && image !== failedImage;
  const classes = [styles.screen, className].filter(Boolean).join(" ");
  const style: CSSProperties = { aspectRatio: ratio };

  return (
    <div className={classes} style={style}>
      {hasImage ? (
        <img
          className={styles.image}
          src={image ?? ""}
          alt={alt}
          style={{ objectFit: fit }}
          onError={() => setFailedImage(image ?? null)}
        />
      ) : null}
      {children}
    </div>
  );
}
