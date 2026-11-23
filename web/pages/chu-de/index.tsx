import Link from "next/link";
import { NextSeo } from "next-seo";
import clsx from "clsx";
import styles from "./styles.module.css";
import EmptyState from "@/components/State/EmptyState";
import ErrorState from "@/components/State/ErrorState";
import Loader from "@/components/loading/list";
import { errorMessage, getGenres } from "@/lib/engine";
import { useAsync } from "@/lib/useAsync";
import { paths } from "@/lib/paths";
import { GRADIENTS } from "@/utils/Items";

export default function DanhSachChuDe() {
  const genres = useAsync(getGenres, []);

  if (genres.loading) {
    return <Loader />;
  }
  if (genres.error) {
    return <ErrorState message={errorMessage(genres.error)} onRetry={genres.reload} />;
  }

  const topics = genres.data?.genres ?? [];

  return (
    <>
      <NextSeo title="Các chủ đề" />
      <div className={styles.a}>
        <div className={styles.b}>Các chủ đề</div>
        <div className={styles.c}>
          {topics.length === 0 ? (
            <EmptyState message="Không có chủ đề nào." />
          ) : (
            <div className={styles.list}>
              {topics.map((topic, index) => (
                <Link
                  href={paths.topic(topic.slug)}
                  key={topic.slug}
                  className={clsx(styles.d, GRADIENTS[index % GRADIENTS.length])}
                >
                  <h3 className={styles.e}>{topic.name}</h3>
                  <div className={styles.f}>
                    <span>Xem chủ đề</span> <i className="fa-solid fa-angle-right"></i>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
