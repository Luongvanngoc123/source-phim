"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import BrowsePage from "@/sections/browse/BrowsePage";
import { getCatalog } from "@/lib/engine";

export default function SapChieu() {
  const router = useRouter();
  const load = useCallback((page: number) => getCatalog("upcoming", page), []);

  return <BrowsePage title="Sắp chiếu" seoTitle="Sắp chiếu" load={router.isReady ? load : null} />;
}
