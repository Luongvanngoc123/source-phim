"use client";

import BrowsePage from "@/sections/browse/BrowsePage";

export default function SapChieu() {
  return (
    <BrowsePage title="Sắp chiếu" seoTitle="Sắp chiếu" spec={{ source: "avs", list: "upcoming" }} />
  );
}
