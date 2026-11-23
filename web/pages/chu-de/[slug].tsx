"use client";

import { useRouter } from "next/router";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import BrowsePage from "@/sections/browse/BrowsePage";
import { errorMessage, getGenres } from "@/lib/engine";
import { useAsync } from "@/lib/useAsync";

export default function TopicPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const genres = useAsync(router.isReady ? getGenres : null, [router.isReady]);
  const topic = genres.data?.genres.find((item) => item.slug === slug);

  if (!router.isReady || genres.loading) {
    return <Loader />;
  }
  if (genres.error) {
    return <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />;
  }
  if (!topic || !slug) {
    return <EmptyState message="Không tìm thấy chủ đề này." />;
  }

  return (
    <BrowsePage title={topic.name} seoTitle={topic.name} spec={{ source: "avs", genre: slug }} />
  );
}
