import { useRef } from "react";
import Play from "@/components/loading/play";
import { useHlsPlayer } from "./useHlsPlayer";

interface VideoPlayerProps {
  watchUrl: string;
  episodeId: string;
  onEnded: () => void;
}

export default function VideoPlayer({ watchUrl, episodeId, onEnded }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const player = useHlsPlayer(videoRef, watchUrl, episodeId);

  const playVideo = () => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    void video.play().catch(() => undefined);
  };

  return (
    <div className="relative h-full w-full bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full"
        controls
        playsInline
        preload="metadata"
        onEnded={onEnded}
      />
      {player.state === "preparing" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/90 text-white">
          <Play className="h-8 w-8" />
          <span className="text-sm">Đang chuẩn bị tập phim...</span>
        </div>
      )}
      {player.state === "blocked" && (
        <button
          type="button"
          onClick={playVideo}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/55 text-white"
          aria-label="Phát video"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-bg-body">
            <i className="fa-solid fa-play text-xl" />
          </span>
          <span>Nhấn để phát</span>
        </button>
      )}
      {player.state === "error" && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/90 px-5 text-center text-white">
          <p>
            {player.error === "not-found"
              ? "Tập này chưa có nguồn phát."
              : "Không thể phát tập này."}
          </p>
          <button
            type="button"
            onClick={player.retry}
            className="rounded-full bg-primary px-4 py-2 font-medium text-bg-body"
          >
            Thử lại
          </button>
        </div>
      )}
    </div>
  );
}
