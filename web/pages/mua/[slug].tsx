"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import BrowsePage from "@/sections/browse/BrowsePage";
import { errorMessage, getGenres, getSeason } from "@/lib/engine";
import { seasonApiSlug } from "@/lib/adapter";
import { useAsync } from "@/lib/useAsync";

export default function SeasonPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const apiSlug = slug ? seasonApiSlug(slug) : undefined;
  const genres = useAsync(router.isReady && apiSlug ? getGenres : null, [apiSlug]);
  const season = genres.data?.seasons.find((item) => item.slug === apiSlug);
  const load = useCallback((page: number) => getSeason(apiSlug ?? "", page), [apiSlug]);

  if (!router.isReady || genres.loading) {
    return <Loader />;
  }
  if (genres.error) {
    return <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />;
  }
  if (!season) {
    return <EmptyState message="Không tìm thấy mùa này." />;
  }

  return (
    <BrowsePage title={season.name} seoTitle={season.name} load={load} directory={genres.data} />
  );
}
