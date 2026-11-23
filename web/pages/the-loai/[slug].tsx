"use client";

import { useCallback } from "react";
import { useRouter } from "next/router";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import BrowsePage from "@/sections/browse/BrowsePage";
import { errorMessage, getGenre, getGenres } from "@/lib/engine";
import { useAsync } from "@/lib/useAsync";

export default function GenrePage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const genres = useAsync(router.isReady && slug ? getGenres : null, [slug]);
  const genre = genres.data?.genres.find((item) => item.slug === slug);
  const load = useCallback((page: number) => getGenre(slug ?? "", page), [slug]);

  if (!router.isReady || genres.loading) {
    return <Loader />;
  }
  if (genres.error) {
    return <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />;
  }
  if (!genre) {
    return <EmptyState message="Không tìm thấy thể loại này." />;
  }

  return (
    <BrowsePage title={genre.name} seoTitle={genre.name} load={load} directory={genres.data} />
  );
}
