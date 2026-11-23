import { useCallback, useEffect, useState } from "react";
import { EngineError } from "./engine";

export interface AsyncState<T> {
  data: T | undefined;
  error: EngineError | undefined;
  loading: boolean;
  reload(): void;
}

interface Settled<T> {
  data?: T;
  error?: EngineError;
  loading: boolean;
}

/**
 * Runs `load` once per change of `deps`, and again on `reload()`. `load === null` means
 * "not ready yet" (for example the router has no query): it stays loading and fetches nothing.
 *
 * `load` may be an inline closure: it is not a dependency itself, so list in `deps` every value
 * it closes over.
 */
export function useAsync<T>(
  load: (() => Promise<T>) | null,
  deps: readonly unknown[],
): AsyncState<T> {
  const [state, setState] = useState<Settled<T>>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const ready = load !== null;

  useEffect(() => {
    setState({ loading: true });
    if (!load) {
      return undefined;
    }
    let current = true;
    load().then(
      (data) => {
        if (current) {
          setState({ data, loading: false });
        }
      },
      (reason: unknown) => {
        if (current) {
          const error = reason instanceof EngineError ? reason : new EngineError(0);
          setState({ error, loading: false });
        }
      },
    );
    return () => {
      current = false;
    };
    // `load` belongs to the render that changed `deps`, which is the one this effect runs for.
  }, [ready, attempt, ...deps]);

  return { data: state.data, error: state.error, loading: state.loading, reload };
}
