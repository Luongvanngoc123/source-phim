/** A title as the cards, shelves and hero read it. Built from engine data in `lib/adapter.ts`. */
interface IMovie {
  _id: string;
  name: string;
  /** Alternative titles; "" when the engine has none. */
  origin_name: string;
  slug: string;
  /** Synopsis; a teaser cut by the upstream for list items. */
  content: string;
  /** Wide image for the hero and the wide shelves; the poster when no key art is known. */
  thumb_url: string;
  /** Vertical poster. */
  poster_url: string;
  /** Wide key art, when the engine knows it. */
  backdrops: string[];
  badges: IBadge[];
  /** Newest episode as the upstream labels it: "09", "PV", "Full"; "" when there is none. */
  episode_current: string;
  /** Planned number of episodes; "?" when unknown. */
  episode_total: string;
  quality: string;
  /** The cards render 0 as "Phụ đề". */
  lang: number[];
  /** 0 when unknown. */
  year: number;
  /** Viewer rating out of 10; 0 when the title has none. */
  rating: number;
  category: ICategory[];
}

interface IBadge {
  type: string;
  text: string;
}
