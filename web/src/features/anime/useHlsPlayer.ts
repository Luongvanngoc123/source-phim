import { useEffect, useState, type RefObject } from "react";
import { playlistUrl } from "../../api/queries";
import type Hls from "hls.js";
import type {
  ErrorData,
  Events,
  FragmentLoaderConstructor,
  FragmentLoaderContext,
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
} from "hls.js";

type HlsConstructor = typeof Hls;

type PlayerState = "preparing" | "ready" | "playing" | "blocked" | "error";
type PlayerError = "not-found" | "fatal" | null;

type PlayerResult = {
  state: PlayerState;
  error: PlayerError;
  retry: () => void;
};

function makeDirectLoader(
  HlsClass: HlsConstructor,
): NonNullable<HlsConfig["fLoader"]> {
  // Hls's default loader is broader than the fragment-loader contract used here.
  const BaseLoader = HlsClass.DefaultConfig.loader as FragmentLoaderConstructor;

  class DirectGoogleCdnLoader extends BaseLoader {
    override load(
      context: FragmentLoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<FragmentLoaderContext>,
    ): void {
      if (!context.url.includes("googleusercontent.com")) {
        super.load(context, config, callbacks);
        return;
      }

      const start =
        typeof context.rangeStart === "number" ? context.rangeStart : 128;
      const end =
        typeof context.rangeEnd === "number" ? context.rangeEnd : undefined;
      context.rangeStart = undefined;
      context.rangeEnd = undefined;
      const originalSuccess = callbacks.onSuccess;
      const wrappedCallbacks: LoaderCallbacks<FragmentLoaderContext> = {
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

  return DirectGoogleCdnLoader;
}

export function useHlsPlayer(
  videoRef: RefObject<HTMLVideoElement | null>,
  watchUrl: string | undefined,
  episodeId: string | undefined,
): PlayerResult {
  const [state, setState] = useState<PlayerState>("preparing");
  const [error, setError] = useState<PlayerError>(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !watchUrl || !episodeId) {
      return undefined;
    }

    let cancelled = false;
    let hls: InstanceType<HlsConstructor> | null = null;
    let hlsEvents: typeof Hls.Events | null = null;
    let networkRecoveries = 0;
    let mediaRecoveries = 0;
    const preparationTimeout = window.setTimeout(() => {
      if (networkRecoveries > 0) {
        updateError("fatal");
      }
    }, 4_000);
    const source = playlistUrl(watchUrl);

    const updateState = (next: PlayerState) => {
      if (!cancelled) {
        setState(next);
      }
    };
    const updateError = (next: PlayerError) => {
      if (!cancelled) {
        setError(next);
        setState(next ? "error" : "preparing");
      }
    };
    const attemptPlay = () => {
      void video
        .play()
        .then(() => updateState("playing"))
        .catch(() => updateState("blocked"));
    };
    const onPlaying = () => updateState("playing");
    const onCanPlay = () => {
      updateState("ready");
      attemptPlay();
    };
    const onError = (_event: Events.ERROR, data: ErrorData) => {
      const status = data.response?.code;
      if (cancelled) {
        return;
      }
      if (status === 404) {
        hls?.stopLoad();
        updateError("not-found");
        return;
      }
      if (status && status >= 400 && status < 600) {
        if (networkRecoveries === 0) {
          networkRecoveries += 1;
          hls?.startLoad();
          return;
        }
        hls?.stopLoad();
        updateError("fatal");
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
      updateError("fatal");
    };
    const onManifestParsed = () => {
      updateState("ready");
      attemptPlay();
    };

    setError(null);
    setState("preparing");
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);

    void import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) {
          return;
        }
        if (Hls.isSupported()) {
          hls = new Hls({ fLoader: makeDirectLoader(Hls) });
          hlsEvents = Hls.Events;
          hls.on(Hls.Events.ERROR, onError);
          hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.loadSource(source);
          hls.attachMedia(video);
          return;
        }
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = source;
          video.load();
          return;
        }
        updateError("fatal");
      })
      .catch(() => updateError("fatal"));

    return () => {
      cancelled = true;
      window.clearTimeout(preparationTimeout);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.pause();
      if (hls && hlsEvents) {
        hls.off(hlsEvents.ERROR, onError);
        hls.off(hlsEvents.MANIFEST_PARSED, onManifestParsed);
        hls.destroy();
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [episodeId, retryCount, videoRef, watchUrl]);

  return {
    state,
    error,
    retry: () => {
      setError(null);
      setState("preparing");
      setRetryCount((count) => count + 1);
    },
  };
}
