import { createBrowserRouter } from "react-router";
import { Home } from "../features/home/Home";
import { animeRoutes } from "../features/anime/routes";
import { browseRoutes } from "../features/browse/routes";
import { Layout } from "./Layout";
import { NotFound } from "./NotFound";
import { RouteError } from "./RouteError";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteError />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      ...browseRoutes,
      ...animeRoutes,
      {
        path: "*",
        element: <NotFound />,
      },
    ],
  },
]);
