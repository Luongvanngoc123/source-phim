"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import BrowsePage from "@/sections/browse/BrowsePage";
import { getCatalog } from "@/lib/engine";

export default function PhimLe() {
  const router = useRouter();
  const load = useCallback((page: number) => getCatalog("movies", page), []);

  return <BrowsePage title="Anime lẻ" seoTitle="Anime lẻ" load={router.isReady ? load : null} />;
}
