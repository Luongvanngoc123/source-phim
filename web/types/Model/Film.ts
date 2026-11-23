type FilmSource = "avs" | "kk";

interface IServer {
  name: string;
  episodes: IEpisode[];
}

interface IFilm {
  movie: IMovie;
  kind: "series" | "movie";
  stats: string[];
  facts: { label: string; value: string; href?: string }[];
  schedule: string;
  servers: IServer[];
  parts: { label: string; title: string; slug: string; active: boolean }[];
}
