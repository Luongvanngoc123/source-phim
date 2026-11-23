/** An episode as the episode lists read it. */
interface IEpisode {
  /** The engine's `episode_id`. */
  _id: string;
  /** "Tập 01" */
  name: string;
  /** Route segment of its watch page, e.g. "tap-01-115975". */
  slug: string;
}
