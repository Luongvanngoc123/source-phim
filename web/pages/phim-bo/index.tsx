"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import BrowsePage from "@/sections/browse/BrowsePage";
import { getCatalog } from "@/lib/engine";

export default function PhimBo() {
  const router = useRouter();
  const load = useCallback((page: number) => getCatalog("series", page), []);

  return <BrowsePage title="Anime bộ" seoTitle="Anime bộ" load={router.isReady ? load : null} />;
}
