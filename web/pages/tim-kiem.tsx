"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import { NextSeo } from "next-seo";
import EmptyState from "@/components/State/EmptyState";
import BrowsePage from "@/sections/browse/BrowsePage";
import { getSearch } from "@/lib/engine";

export default function TimKiem() {
  const router = useRouter();
  const query = typeof router.query.q === "string" ? router.query.q.trim() : "";
  const load = useCallback((page: number) => getSearch(query, page), [query]);

  if (!router.isReady || !query) {
    return (
      <>
        <NextSeo title="Tìm kiếm" />
        <div className="pb-28 pt-5 px-5 lg:px-6">
          <EmptyState message="Nhập từ khóa để tìm kiếm." />
        </div>
      </>
    );
  }

  return <BrowsePage title={`Tìm kiếm: ${query}`} seoTitle={`Tìm kiếm: ${query}`} load={load} />;
}
