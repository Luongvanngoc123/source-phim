import { useEffect } from "react";

/** Names the browser tab after the page that is mounted: "<title> — Animora". */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} — Animora`;
  }, [title]);
}
