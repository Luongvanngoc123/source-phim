import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import { paths } from "@/lib/paths";

export default function NotFoundPage() {
  return (
    <section className="px-5 py-24 text-center lg:px-6">
      <Wordmark className="text-3xl" />
      <h1 className="mt-8 text-4xl font-bold text-white">Không tìm thấy trang</h1>
      <p className="mt-3 text-white/60">Nội dung bạn tìm kiếm không tồn tại.</p>
      <Link
        href={paths.home}
        className="mt-8 inline-flex rounded-full bg-primary px-5 py-2.5 font-medium text-bg-body"
      >
        Về trang chủ
      </Link>
    </section>
  );
}
