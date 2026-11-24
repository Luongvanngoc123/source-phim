import Wordmark from "@/components/Wordmark";

/** Full-screen placeholder shown until the page has what it needs to draw. */
const LoadingOverlay = () => (
  <div
    role="status"
    aria-label="Đang tải"
    className="fixed inset-0 z-[1000] flex flex-col items-center justify-center gap-6 bg-bg-body"
  >
    <Wordmark className="text-4xl sm:text-5xl" />
    <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/15 border-t-primary" />
  </div>
);

export default LoadingOverlay;
