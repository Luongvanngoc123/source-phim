/** An episode as the episode lists read it. */
interface IEpisode {
  /** Unique within its server. */
  _id: string;
  /** "Tập 01" */
  name: string;
  /** Route segment of its watch page, e.g. "tap-01-115975". */
  slug: string;
  /** Engine watch pages are resolved by the Rust engine; KKPhim links are direct HLS. */
  stream: { kind: "engine" | "direct"; url: string };
}
