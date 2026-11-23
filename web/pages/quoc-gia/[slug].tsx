"use client";

import { useRouter } from "next/router";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import BrowsePage from "@/sections/browse/BrowsePage";
import { errorMessage } from "@/lib/engine";
import { getDirectories } from "@/lib/catalog";
import { useAsync } from "@/lib/useAsync";

export default function CountryPage() {
  const router = useRouter();
  const slug = typeof router.query.slug === "string" ? router.query.slug : undefined;
  const directories = useAsync(router.isReady ? getDirectories : null, [router.isReady]);
  const country = directories.data?.countries.find((item) => item.slug === slug);

  if (!router.isReady || directories.loading) {
    return <Loader />;
  }
  if (directories.error) {
    return <ErrorState message={errorMessage(directories.error)} onRetry={directories.reload} />;
  }
  if (!country) {
    return <EmptyState message="Không tìm thấy quốc gia này." />;
  }

  return (
    <BrowsePage
      title={country.name}
      seoTitle={country.name}
      spec={{ source: "kk", country: country.slug }}
    />
  );
}
