import { useEffect, useRef, useState, type JSX } from "react";
import Artplayer, { type Option as ArtOption } from "artplayer";
import vi from "artplayer/i18n/vi";
import type Hls from "hls.js";
import type {
  ErrorData,
  FragmentLoaderConstructor,
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  PlaylistLoaderConstructor,
} from "hls.js";
import { stripAdBreaks } from "../../lib/adfilter";
import styles from "./VideoPlayer.module.css";

type HlsConstructor = typeof Hls;
type ArtControl = NonNullable<ArtOption["controls"]>[number];
type ArtLayer = NonNullable<ArtOption["layers"]>[number];
type PlaybackState = "preparing" | "ready" | "error";
type PlaybackError = "not-found" | "fatal" | null;

export interface VideoPlayerProps {
  src: string;
  kind: "engine" | "direct";
  title: string;
  poster?: string;
  startAt?: number;
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
  onNext?: () => void;
  nextLabel?: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function makeFragmentLoader(HlsClass: HlsConstructor): NonNullable<HlsConfig["fLoader"]> {
  const BaseLoader = HlsClass.DefaultConfig.loader as FragmentLoaderConstructor;

  class GoogleHeaderLoader extends BaseLoader {
    override load(
      context: Parameters<InstanceType<FragmentLoaderConstructor>["load"]>[0],
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<Parameters<InstanceType<FragmentLoaderConstructor>["load"]>[0]>,
    ): void {
      if (!context.url.includes("googleusercontent.com")) {
        super.load(context, config, callbacks);
        return;
      }
      const start = typeof context.rangeStart === "number" ? context.rangeStart : 128;
      const end = typeof context.rangeEnd === "number" ? context.rangeEnd : undefined;
      context.rangeStart = undefined;
      context.rangeEnd = undefined;
      const originalSuccess = callbacks.onSuccess;
      const wrappedCallbacks: typeof callbacks = {
        ...callbacks,
        onSuccess: (response, stats, loadedContext, networkDetails) => {
          if (response.data instanceof ArrayBuffer) {
            response.data = response.data.slice(start, end);
          }
          originalSuccess(response, stats, loadedContext, networkDetails);
        },
      };
      super.load(context, config, wrappedCallbacks);
    }
  }

  return GoogleHeaderLoader;
}

function makeAdPlaylistLoader(
  HlsClass: HlsConstructor,
  onRemoved: (seconds: number) => void,
): PlaylistLoaderConstructor {
  // `pLoader` is unset by default; hls.js builds its playlist loader from `loader`.
  const BaseLoader = HlsClass.DefaultConfig.loader as unknown as PlaylistLoaderConstructor;
  class AdFilteringPlaylistLoader extends BaseLoader {
    override load(
      context: Parameters<InstanceType<PlaylistLoaderConstructor>["load"]>[0],
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<Parameters<InstanceType<PlaylistLoaderConstructor>["load"]>[0]>,
    ): void {
      const originalSuccess = callbacks.onSuccess;
      const wrappedCallbacks: typeof callbacks = {
        ...callbacks,
        onSuccess: (response, stats, loadedContext, networkDetails) => {
          if (typeof response.data === "string") {
            const filtered = stripAdBreaks(response.data);
            if (filtered.removed.length > 0) {
              onRemoved(filtered.removed.reduce((total, run) => total + run.duration, 0));
            }
            response.data = filtered.playlist;
          }
          originalSuccess(response, stats, loadedContext, networkDetails);
        },
      };
      super.load(context, config, wrappedCallbacks);
    }
  }
  return AdFilteringPlaylistLoader;
}

function createControls(
  nextLabel: string | undefined,
  onNext: (() => void) | undefined,
): ArtControl[] {
  const controls: ArtControl[] = [
    {
      name: "backward-ten",
      position: "left",
      tooltip: "Lùi 10 giây",
      html: '<button type="button" class="avs-player-control" aria-label="Lùi 10 giây"><i class="fa-solid fa-rotate-left"></i><span>10</span></button>',
      click(this: Artplayer) {
        this.backward = 10;
      },
    },
    {
      name: "forward-ten",
      position: "left",
      tooltip: "Tiến 10 giây",
      html: '<button type="button" class="avs-player-control" aria-label="Tiến 10 giây"><i class="fa-solid fa-rotate-right"></i><span>10</span></button>',
      click(this: Artplayer) {
        this.forward = 10;
      },
    },
  ];
  if (onNext) {
    controls.push({
      name: "next-episode",
      position: "right",
      tooltip: nextLabel ?? "Tập tiếp theo",
      html: `<button type="button" class="avs-player-control avs-player-next" aria-label="${escapeHtml(nextLabel ?? "Tập tiếp theo")}"><i class="fa-solid fa-forward-step"></i><span>${escapeHtml(nextLabel ?? "Tập tiếp theo")}</span></button>`,
      click() {
        onNext();
      },
    });
  }
  return controls;
}

function createTitleLayer(title: string): ArtLayer {
  return {
    name: "episode-title",
    html: `<div class="avs-player-title">${escapeHtml(title)}</div>`,
  };
}

export default function VideoPlayer({
  src,
  kind,
  title,
  poster,
  startAt,
  onProgress,
  onEnded,
  onNext,
  nextLabel,
}: VideoPlayerProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef({ onProgress, onEnded });
  const [state, setState] = useState<PlaybackState>("preparing");
  const [error, setError] = useState<PlaybackError>(null);
  const [retryCount, setRetryCount] = useState(0);
  const nextRef = useRef<{ callback?: () => void; label?: string }>({
    callback: onNext,
    label: nextLabel,
  });
  nextRef.current = { callback: onNext, label: nextLabel };

  callbackRef.current = { onProgress, onEnded };
  // Read when the stream opens. A later change must not rebuild the player mid-playback.
  const startAtRef = useRef(startAt);
  startAtRef.current = startAt;

  useEffect(() => {
    const root = rootRef.current;
    const container = containerRef.current;
    if (!root || !container) {
      return undefined;
    }
    let cancelled = false;
    let art: Artplayer | null = null;
    let videoElement: HTMLVideoElement | null = null;
    let hls: InstanceType<HlsConstructor> | null = null;
    let reportTimer: ReturnType<typeof setInterval> | null = null;
    let resumeApplied = false;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    let failed = false;
    let lastTap: { time: number; x: number } | null = null;

    // The player's own notice sits inside its element, so it stays visible in fullscreen.
    const showNotice = (message: string) => {
      if (art) {
        art.notice.show = message;
      }
    };
    const reportProgress = () => {
      const video = art?.video;
      if (!video || !Number.isFinite(video.currentTime)) {
        return;
      }
      callbackRef.current.onProgress?.(
        video.currentTime,
        Number.isFinite(video.duration) ? video.duration : 0,
      );
    };
    const setFatalError = (next: PlaybackError) => {
      if (cancelled) {
        return;
      }
      failed = true;
      setError(next);
      setState("error");
    };
    const destroyHls = () => {
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
    const applyResume = () => {
      const video = art?.video;
      if (resumeApplied || !video || !Number.isFinite(video.duration)) {
        return;
      }
      resumeApplied = true;
      const startAt = startAtRef.current;
      if (typeof startAt === "number" && startAt > 0) {
        const position = Math.min(startAt, video.duration);
        video.currentTime = position;
        showNotice(`Tiếp tục từ ${formatTime(position)}`);
      }
    };
    const onTouchEnd = (event: Event) => {
      const touchEvent = event as TouchEvent;
      const touch = touchEvent.changedTouches[0];
      const video = art?.video;
      if (!touch || !video) {
        return;
      }
      const now = Date.now();
      const bounds = root.getBoundingClientRect();
      const x = touch.clientX - bounds.left;
      if (lastTap && now - lastTap.time < 320 && Math.abs(x - lastTap.x) < 120) {
        event.preventDefault();
        video.currentTime = Math.max(
          0,
          Math.min(
            video.duration || Number.POSITIVE_INFINITY,
            video.currentTime + (x < bounds.width / 2 ? -10 : 10),
          ),
        );
        showNotice(`${x < bounds.width / 2 ? "Lùi" : "Tiến"} 10 giây`);
        lastTap = null;
      } else {
        lastTap = { time: now, x };
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.target instanceof Node) || !root.contains(event.target)) {
        return;
      }
      const video = art?.video;
      if (
        !video ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLButtonElement
      ) {
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        art?.toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (art) {
          art.backward = 10;
        }
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (art) {
          art.forward = 10;
        }
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (art) {
          art.fullscreen = !art.fullscreen;
        }
      } else if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        video.muted = !video.muted;
      }
    };

    root.addEventListener("touchend", onTouchEnd, { passive: false });
    document.addEventListener("keydown", onKeyDown);
    setState("preparing");
    setError(null);
    const onPause = () => reportProgress();
    const mount = async () => {
      try {
        if (cancelled) {
          return;
        }
        const options: ArtOption = {
          container,
          url: src,
          type: "m3u8",
          poster,
          theme: "rgb(var(--primary))",
          cssVar: {
            "--art-theme": "rgb(var(--primary))",
            "--art-progress-height": "3px",
            "--art-control-icon-size": "18px",
            "--art-bottom-height": "48px",
          },
          autoplay: false,
          playsInline: true,
          mutex: true,
          hotkey: false,
          playbackRate: true,
          pip: true,
          fullscreen: true,
          fullscreenWeb: true,
          setting: true,
          lang: "vi",
          i18n: { vi },
          controls: createControls(
            nextRef.current.label,
            nextRef.current.callback ? () => nextRef.current.callback?.() : undefined,
          ),
          layers: [createTitleLayer(title)],
          customType: {
            m3u8: async (video, url, currentArt) => {
              try {
                const { default: HlsClass } = await import("hls.js");
                if (cancelled) {
                  return;
                }
                if (!HlsClass.isSupported()) {
                  if (video.canPlayType("application/vnd.apple.mpegurl")) {
                    video.src = url;
                    video.load();
                    return;
                  }
                  setFatalError("fatal");
                  return;
                }
                const config: Partial<HlsConfig> = {
                  fLoader: makeFragmentLoader(HlsClass),
                };
                if (kind === "direct") {
                  config.pLoader = makeAdPlaylistLoader(HlsClass, (seconds) => {
                    showNotice(`Đã bỏ qua ${formatTime(seconds)} quảng cáo`);
                  });
                }
                hls = new HlsClass(config);
                hls.on(HlsClass.Events.ERROR, (_event, data: ErrorData) => {
                  if (cancelled) {
                    return;
                  }
                  const status = data.response?.code;
                  if (status === 404) {
                    destroyHls();
                    setFatalError("not-found");
                    return;
                  }
                  if (!data.fatal) {
                    return;
                  }
                  if (data.type === "networkError" && networkRecoveries === 0) {
                    networkRecoveries += 1;
                    hls?.startLoad();
                    return;
                  }
                  if (data.type === "mediaError" && mediaRecoveries === 0) {
                    mediaRecoveries += 1;
                    hls?.recoverMediaError();
                    return;
                  }
                  destroyHls();
                  setFatalError("fatal");
                });
                hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
                  if (!cancelled) {
                    setState("ready");
                  }
                });
                hls.loadSource(url);
                hls.attachMedia(video);
                currentArt.on("destroy", destroyHls);
              } catch {
                setFatalError("fatal");
              }
            },
          },
        };
        art = new Artplayer(options);
        const video = art.video;
        videoElement = video;
        video.addEventListener("loadedmetadata", applyResume);
        video.addEventListener("canplay", () => {
          if (!cancelled && !failed) {
            setState("ready");
          }
        });
        video.addEventListener("playing", () => setState("ready"));
        video.addEventListener("pause", onPause);
        video.addEventListener("ended", () => callbackRef.current.onEnded?.());
        reportTimer = setInterval(() => {
          if (!video.paused) {
            reportProgress();
          }
        }, 5000);
      } catch {
        setFatalError("fatal");
      }
    };
    void mount();

    return () => {
      cancelled = true;
      root.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("keydown", onKeyDown);
      videoElement?.removeEventListener("pause", onPause);
      if (reportTimer !== null) {
        clearInterval(reportTimer);
      }
      reportProgress();
      destroyHls();
      art?.destroy(false);
      art = null;
    };
  }, [kind, poster, retryCount, src, title]);

  const retry = () => {
    setRetryCount((count) => count + 1);
  };

  return (
    <div ref={rootRef} className={styles.player} tabIndex={0}>
      {/* The player library rebuilds this element's content, so React renders nothing in it. */}
      <div ref={containerRef} className={styles.stage} />
      {state === "preparing" && (
        <div className={styles.overlay} role="status">
          <span className={styles.spinner} aria-hidden="true" />
          <span>Đang chuẩn bị tập phim...</span>
        </div>
      )}
      {state === "error" && (
        <div className={styles.overlay} role="alert">
          <p>{error === "not-found" ? "Tập này chưa có nguồn phát." : "Không thể phát tập này."}</p>
          <button type="button" className={styles.retry} onClick={retry}>
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
