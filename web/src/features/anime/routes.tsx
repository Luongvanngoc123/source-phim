import type { RouteObject } from "react-router";
import { AnimeDetailPage } from "./AnimeDetailPage";
import { WatchPage } from "./WatchPage";

export const animeRoutes: RouteObject[] = [
  {
    path: "phim/:slug",
    element: <AnimeDetailPage />,
  },
  {
    path: "phim/:slug/tap/:episodeId",
    element: <WatchPage />,
  },
];
