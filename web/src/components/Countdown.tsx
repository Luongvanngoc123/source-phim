import { useEffect, useState } from "react";
import { countdownText } from "../lib/format";
import styles from "./Countdown.module.css";

type CountdownProps = {
  toUnix: number;
  live?: boolean;
  nowOffset?: number;
};

function currentUnix(offset: number): number {
  return Math.floor(Date.now() / 1000) + offset;
}

export function Countdown({
  toUnix,
  live = false,
  nowOffset = 0,
}: CountdownProps) {
  const [now, setNow] = useState(() => currentUnix(nowOffset));

  useEffect(() => {
    if (!live) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setNow(currentUnix(nowOffset));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [live, nowOffset]);

  return (
    <span className={styles.countdown}>
      {countdownText(toUnix - now, live)}
    </span>
  );
}
