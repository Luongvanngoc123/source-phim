import Wordmark from "@/components/Wordmark";

const LoadingOverlay = () => (
  <div className="fixed inset-0 z-[1000] flex justify-center items-center bg-[url(/images/home-background.jpg)] animate-bodyLoadEffect">
    <div className="bl-logo flex flex-col items-center gap-8 text-4xl font-semibold text-white/30 animate-logoLoad max-w-[800px]">
      <Wordmark className="text-5xl" />
      <div className="text-center">Xem Anime Miễn Phí, Chất Lượng Cao Và Cập Nhật Liên Tục</div>
    </div>
  </div>
);

export default LoadingOverlay;
