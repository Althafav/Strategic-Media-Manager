import type { MediaItem } from "@/lib/onedrive/types";

/**
 * The team's selection, kept while moving between folders and search so photos from several folders can be
 * shared or downloaded together. Lives in sessionStorage: it survives reloads and ends with the tab.
 */
export type Selection = ReadonlyMap<string, MediaItem>;

const STORAGE_KEY = "smm:selection";
const EMPTY: Selection = new Map();
const listeners = new Set<() => void>();
let current: Selection | null = null;

export function subscribeSelection(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getSelection(): Selection {
  if (!current) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      current = raw ? new Map(JSON.parse(raw) as [string, MediaItem][]) : EMPTY;
    } catch {
      current = EMPTY;
    }
  }
  return current;
}

export const getServerSelection = () => EMPTY;

export function setSelection(next: Selection) {
  current = next;
  try {
    if (next.size) sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage blocked or full: the selection still lasts until the page reloads.
  }
  for (const fn of listeners) fn();
}
