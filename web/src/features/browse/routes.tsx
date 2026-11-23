import type { RouteObject } from "react-router";
import { CatalogPage } from "./CatalogPage";
import { GenrePage } from "./GenrePage";
import { GenresPage } from "./GenresPage";
import { SchedulePage } from "./SchedulePage";
import { SearchPage } from "./SearchPage";
import { SeasonPage } from "./SeasonPage";

export const browseRoutes: RouteObject[] = [
  {
    path: "/lich-chieu",
    element: <SchedulePage />,
  },
  {
    path: "/anime-bo",
    element: <CatalogPage kind="series" title="Anime bộ" />,
  },
  {
    path: "/anime-le",
    element: <CatalogPage kind="movies" title="Anime lẻ" />,
  },
  {
    path: "/sap-chieu",
    element: <CatalogPage kind="upcoming" title="Sắp chiếu" />,
  },
  {
    path: "/the-loai",
    element: <GenresPage />,
  },
  {
    path: "/the-loai/:slug",
    element: <GenrePage />,
  },
  {
    path: "/mua/:season/:year",
    element: <SeasonPage />,
  },
  {
    path: "/tim-kiem",
    element: <SearchPage />,
  },
];
