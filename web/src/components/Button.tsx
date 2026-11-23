import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router";
import styles from "./Button.module.css";

type Variant = "play" | "plain";

type ButtonVariantProps = {
  variant?: Variant;
};

export function Button({
  variant = "plain",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & ButtonVariantProps) {
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return <button {...props} className={classes} type={type} />;
}

export function ButtonLink({
  variant = "plain",
  className,
  ...props
}: LinkProps & ButtonVariantProps) {
  const classes = [styles.button, styles[variant], className]
    .filter(Boolean)
    .join(" ");

  return <Link {...props} className={classes} />;
}
