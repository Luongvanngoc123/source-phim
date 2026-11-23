"use client";

import { useRouter } from "next/router";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import BrowsePage from "@/sections/browse/BrowsePage";
import { errorMessage, getGenres } from "@/lib/engine";
import { seasonApiSlug } from "@/lib/adapter";
import { useAsync } from "@/lib/useAsync";

export default function SeasonPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const apiSlug = slug ? seasonApiSlug(slug) : undefined;
  const genres = useAsync(router.isReady && apiSlug ? getGenres : null, [apiSlug, router.isReady]);
  const season = genres.data?.seasons.find((item) => item.slug === apiSlug);

  if (!router.isReady || genres.loading) {
    return <Loader />;
  }
  if (genres.error) {
    return <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />;
  }
  if (!season || !apiSlug) {
    return <EmptyState message="Không tìm thấy mùa này." />;
  }

  return (
    <BrowsePage
      title={season.name}
      seoTitle={season.name}
      spec={{ source: "avs", season: apiSlug }}
      directory={genres.data}
    />
  );
}
