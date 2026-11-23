import { useSyncExternalStore } from "react";

export type Lights = "on" | "off";

const STORAGE_KEY = "animora:lights";
const listeners = new Set<() => void>();

function readLights(): Lights {
  return document.documentElement.dataset.lights === "off" ? "off" : "on";
}

function writeLights(next: Lights): void {
  document.documentElement.dataset.lights = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode can refuse storage; the room still changes for this visit.
  }
  listeners.forEach((notify) => notify());
}

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/**
 * The room's lights. `index.html` sets `<html data-lights>` before first paint; this hook reads
 * and flips that attribute, so every toggle on the page stays in step.
 */
export function useLights(): { lights: Lights; toggle: () => void } {
  const lights = useSyncExternalStore(subscribe, readLights);
  const toggle = () => writeLights(lights === "on" ? "off" : "on");
  return { lights, toggle };
}
