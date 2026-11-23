/** A title as the cards, shelves and hero read it. */
interface IMovie {
  source: FilmSource;
  _id: string;
  name: string;
  /** Alternative titles; "" when the source has none. */
  origin_name: string;
  slug: string;
  /** Synopsis; a teaser cut by the upstream for list items. */
  content: string;
  /** Wide image for the hero and the wide shelves; the poster when no key art is known. */
  thumb_url: string;
  /** Vertical poster. */
  poster_url: string;
  /** Wide key art, when the source knows it. */
  backdrops: string[];
  badges: IBadge[];
  episode_current: string;
  episode_total: string;
  quality: string;
  /** 0 "Phụ đề", 1 "Thuyết minh", 2 "Lồng tiếng". */
  lang: number[];
  year: number;
  rating: number;
  category: ICategory[];
}

interface IBadge {
  type: string;
  text: string;
}
