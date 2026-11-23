import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { useAuth } from "@/context/AuthContext";
import { getFavorites, getProgress } from "@/lib/account";
import { getLocalProgress } from "@/lib/progress";
import {
  buildRecommendationPlan,
  getRecommendationShelf,
  recommendationExcludedIds,
  type RecommendationShelf,
} from "@/lib/recommend";
import MovieList from "@/components/Movie/MovieList";

interface LoadedShelf extends RecommendationShelf {
  movies: IMovie[];
}

export default function Recommendations(): ReactElement | null {
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<RecommendationShelf[]>([]);
  const [loaded, setLoaded] = useState<LoadedShelf[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasHistory, setHasHistory] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  // Films the reader already knows plus the ones an earlier shelf has shown: genres overlap,
  // so without this the same film would repeat from shelf to shelf.
  const hiddenRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    const loadHistory = async () => {
      try {
        const saved = user ? await getFavorites() : [];
        const progress = user ? await getProgress() : getLocalProgress();
        if (!active) return;
        const history = { saved, progress };
        hiddenRef.current = recommendationExcludedIds(history);
        indexRef.current = 0;
        setLoaded([]);
        setHasHistory(saved.length + progress.length > 0);
        setPlan(buildRecommendationPlan(history));
      } catch {
        if (active) setPlan([]);
      }
    };
    void loadHistory();
    return () => {
      active = false;
    };
  }, [authLoading, user?.id]);

  const loadNext = useCallback(async () => {
    if (loading || indexRef.current >= plan.length) return;
    const index = indexRef.current;
    indexRef.current += 1;
    setLoading(true);
    setError(null);
    try {
      const shelf = plan[index];
      const movies = await getRecommendationShelf(shelf, hiddenRef.current);
      for (const movie of movies) hiddenRef.current.add(movie.slug);
      setLoaded((current) => [...current, { ...shelf, movies }]);
    } catch {
      // Step back so the retry button asks for the shelf that failed.
      indexRef.current = index;
      setError("Không thể tải đề xuất. Bấm để thử lại.");
    } finally {
      setLoading(false);
    }
  }, [loading, plan]);

  useEffect(() => {
    if (!sentinel.current || plan.length === 0 || error) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadNext();
      },
      { rootMargin: "500px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [error, loadNext, plan.length]);

  if (authLoading || plan.length === 0) return null;
  return (
    <section className="mt-12 lg:mt-16 pb-8">
      <h2 className="text-white text-lg lg:text-xl xl:text-2xl font-semibold">Đề xuất cho bạn</h2>
      <p className="text-gray-400 text-sm mt-1">
        {hasHistory
          ? "Chọn theo thể loại của những phim bạn đã xem và đã lưu."
          : "Xem hoặc lưu vài phim để nhận gợi ý theo sở thích. Dưới đây là các thể loại gợi ý trong ngày."}
      </p>
      {loaded.map(
        (shelf) =>
          shelf.movies.length > 0 && (
            <div key={shelf.title} className="mt-8 animate-fade-in-up">
              <h3 className="text-white text-base lg:text-lg font-medium mb-4">{shelf.title}</h3>
              <MovieList movies={shelf.movies} />
            </div>
          ),
      )}
      {error && (
        <button
          type="button"
          onClick={() => void loadNext()}
          className="text-red-400 underline mt-6"
        >
          {error}
        </button>
      )}
      {loading && <p className="text-gray-400 text-sm mt-6">Đang tải đề xuất...</p>}
      <div ref={sentinel} className="h-1" aria-hidden="true" />
    </section>
  );
}
