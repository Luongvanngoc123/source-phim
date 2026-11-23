import type { ReactNode } from "react";
import { Button, ButtonLink } from "./Button";
import styles from "./Notice.module.css";

type NoticeAction = {
  label: string;
  onClick?: () => void;
  to?: string;
};

type NoticeProps = {
  kind: "loading" | "error" | "empty";
  title: string;
  action?: NoticeAction;
  children?: ReactNode;
};

function renderAction(action: NoticeAction | undefined): ReactNode {
  if (!action) {
    return null;
  }
  if (action.to !== undefined) {
    return (
      <div className={styles.action}>
        <ButtonLink to={action.to}>{action.label}</ButtonLink>
      </div>
    );
  }
  if (action.onClick) {
    return (
      <div className={styles.action}>
        <Button type="button" onClick={action.onClick}>
          {action.label}
        </Button>
      </div>
    );
  }
  return null;
}

function noticeRole(kind: NoticeProps["kind"]): "status" | "alert" | undefined {
  if (kind === "loading") {
    return "status";
  }
  if (kind === "error") {
    return "alert";
  }
  return undefined;
}

export function Notice({ kind, title, action, children }: NoticeProps) {
  const role = noticeRole(kind);

  return (
    <section className={`${styles.notice} ${styles[kind]}`} role={role}>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {renderAction(action)}
    </section>
  );
}
