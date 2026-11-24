import Artplayer from "artplayer";
import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";

type HlsConstructor = typeof Hls;

interface SeekPreviewOptions {
  art: Artplayer;
  src: string;
  /** `file` for a single video file the browser can seek in by itself. */
  mode: "hls" | "file";
  /** The hls.js class the main player loaded, or null while it has none (native playback). */
  hlsClass: () => HlsConstructor | null;
  /** The loaders the main player uses, so both players read the same timeline. */
  hlsConfig: (HlsClass: HlsConstructor) => Partial<HlsConfig>;
}

/** How long the pointer has to rest before the frame under it is fetched. */
const REST_DELAY_MS = 140;

/**
 * Shows the frame and time the progress bar points at while the pointer hovers over it or
 * drags along it.
 *
 * The streams come with no thumbnail track, and making one would mean processing video on
 * the server. So the frame is the real one: a second, hidden player seeks to the time and its
 * picture is shown. That costs the download of the segment holding that moment, which is why
 * nothing is fetched until the pointer rests, and nothing at all for a viewer who never
 * touches the bar or who has asked the browser to save data.
 *
 * Returns the function that removes the preview again.
 */
export function attachSeekPreview({
  art,
  src,
  mode,
  hlsClass,
  hlsConfig,
}: SeekPreviewOptions): () => void {
  const progress = art.template.$progress;
  const player = art.template.$player;

  const tip = document.createElement("div");
  tip.className = "avs-seek-preview";
  tip.setAttribute("aria-hidden", "true");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "none";
  video.tabIndex = -1;
  const label = document.createElement("span");
  tip.append(video, label);
  progress.append(tip);

  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ===
    true;
  let hls: Hls | null = null;
  let started = false;
  let ready = false;
  let framesUnavailable = saveData;
  let wanted: number | undefined;
  let restTimer: number | undefined;
  let dragging = false;

  const withoutFrame = () => {
    framesUnavailable = true;
    tip.classList.add("avs-seek-preview-time-only");
    tip.classList.remove("avs-seek-preview-loading");
  };
  if (saveData) withoutFrame();

  const fetchFrame = (time: number) => {
    if (!ready) return;
    tip.classList.add("avs-seek-preview-loading");
    hls?.startLoad(time);
    video.currentTime = time;
  };

  const onMetadata = () => {
    ready = true;
    if (wanted !== undefined) fetchFrame(wanted);
  };
  const onFileError = () => withoutFrame();

  const startPlayer = () => {
    if (started || framesUnavailable) return;
    if (mode === "file") {
      // The browser reads the index of the file, then only the stretch around each stop.
      started = true;
      video.addEventListener("loadedmetadata", onMetadata);
      video.addEventListener("error", onFileError);
      video.preload = "metadata";
      video.src = src;
      return;
    }
    const HlsClass = hlsClass();
    if (!HlsClass) return;
    started = true;
    const instance = new HlsClass({
      ...hlsConfig(HlsClass),
      // One frame is wanted, not playback: load on request only, keep next to nothing
      // buffered and take the smallest rendition on offer.
      autoStartLoad: false,
      maxBufferLength: 1,
      maxMaxBufferLength: 2,
      backBufferLength: 0,
      startLevel: 0,
      capLevelToPlayerSize: true,
    });
    hls = instance;
    instance.on(HlsClass.Events.MANIFEST_PARSED, () => {
      ready = true;
      if (wanted !== undefined) fetchFrame(wanted);
    });
    instance.on(HlsClass.Events.ERROR, (_event, data) => {
      // The time is still worth showing when frames cannot be had.
      if (data.fatal) {
        instance.destroy();
        hls = null;
        ready = false;
        withoutFrame();
      }
    });
    instance.loadSource(src);
    instance.attachMedia(video);
  };

  /** `fraction` is the place on the bar, 0 at its start and 1 at its end. */
  const show = (fraction: number) => {
    const duration = art.duration;
    const width = progress.clientWidth;
    if (!Number.isFinite(duration) || duration <= 0 || width <= 0) return;
    const time = fraction * duration;
    label.textContent = Artplayer.utils.secondToTime(time);
    tip.classList.add("avs-seek-preview-show");
    player.classList.add("avs-seek-previewing");
    // Centred on that place, but never past either end of the bar.
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(fraction * width, half), Math.max(half, width - half))}px`;

    wanted = time;
    window.clearTimeout(restTimer);
    restTimer = window.setTimeout(() => {
      if (started) fetchFrame(time);
      else startPlayer();
    }, REST_DELAY_MS);
  };

  const hide = () => {
    tip.classList.remove("avs-seek-preview-show", "avs-seek-preview-loading");
    player.classList.remove("avs-seek-previewing");
    wanted = undefined;
    window.clearTimeout(restTimer);
    hls?.stopLoad();
  };

  // The player itself reports where a pointer puts the bar, and that is the place it seeks
  // to. On a phone it is not the spot under the finger (a drag there moves the bar by the
  // distance travelled), so the bar is followed rather than the pointer.
  const onSetBar = (type: string, fraction: number, event?: Event) => {
    // Without an event the bar is only keeping up with playback.
    if (!event || type === "loaded") return;
    if (event.type === "mouseleave") {
      if (!dragging) hide();
      return;
    }
    show(fraction);
  };
  const onSeeked = () => {
    tip.classList.remove("avs-seek-preview-loading");
    // The frame is on screen; anything loaded past it would be buffer nobody watches.
    hls?.stopLoad();
  };
  const onMouseDown = (event: MouseEvent) => {
    // A drag carries on after the pointer has left the bar.
    if (event.button === 0) dragging = true;
  };
  const onMouseUp = (event: Event) => {
    if (!dragging) return;
    dragging = false;
    if (!(event.target instanceof Node) || !progress.contains(event.target)) hide();
  };

  art.on("setBar", onSetBar);
  art.on("document:mouseup", onMouseUp);
  video.addEventListener("seeked", onSeeked);
  progress.addEventListener("mousedown", onMouseDown);
  document.addEventListener("touchend", hide);
  document.addEventListener("touchcancel", hide);

  return () => {
    hide();
    art.off("setBar", onSetBar);
    art.off("document:mouseup", onMouseUp);
    video.removeEventListener("seeked", onSeeked);
    video.removeEventListener("loadedmetadata", onMetadata);
    video.removeEventListener("error", onFileError);
    progress.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("touchend", hide);
    document.removeEventListener("touchcancel", hide);
    hls?.destroy();
    hls = null;
    if (mode === "file") {
      // Without its source the element lets go of the open download.
      video.removeAttribute("src");
      video.load();
    }
    tip.remove();
  };
}
