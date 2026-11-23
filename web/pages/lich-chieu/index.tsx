import React from "react";
import dynamic from "next/dynamic";
import { NextSeo } from "next-seo";

const CalendarList = dynamic(() => import("@/components/Calendar/CalendarList"), {
  ssr: false,
});

import ICON from "@/types/icon";
import styles from "./styles.module.css";

const LichChieu: React.FC = () => {
  return (
    <>
      <NextSeo title="Lịch chiếu" />

      <div className={styles.a}>
        <div className={styles.b}>
          <ICON.Calendar width={32} height={32} />
          <span>Lịch chiếu</span>
        </div>

        <div className={styles.c}>
          <CalendarList />
        </div>
      </div>
    </>
  );
};

export default LichChieu;
