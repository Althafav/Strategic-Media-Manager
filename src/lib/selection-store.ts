import type { MediaItem } from "@/lib/onedrive/types";

/**
 * A selection kept while moving between folders and search so photos from several folders can be
 * shared or downloaded together. Lives in sessionStorage: it survives reloads and ends with the tab.
 * One per `scope`: "" is the team's; a share token is that link's visitors', so picks (and their t/sig)
 * never mix between links or with the team's.
 */
export type Selection = ReadonlyMap<string, MediaItem>;

const STORAGE_KEY = "smm:selection";
const EMPTY: Selection = new Map();
const listeners = new Set<() => void>();
const loaded = new Map<string, Selection>();

const storageKey = (scope: string) => (scope ? `${STORAGE_KEY}:${scope}` : STORAGE_KEY);

export function subscribeSelection(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getSelection(scope = ""): Selection {
  let current = loaded.get(scope);
  if (!current) {
    try {
      const raw = sessionStorage.getItem(storageKey(scope));
      current = raw ? new Map(JSON.parse(raw) as [string, MediaItem][]) : EMPTY;
    } catch {
      current = EMPTY;
    }
    loaded.set(scope, current);
  }
  return current;
}

export const getServerSelection = () => EMPTY;

export function setSelection(next: Selection, scope = "") {
  loaded.set(scope, next);
  try {
    if (next.size) sessionStorage.setItem(storageKey(scope), JSON.stringify([...next]));
    else sessionStorage.removeItem(storageKey(scope));
  } catch {
    // Storage blocked or full: the selection still lasts until the page reloads.
  }
  for (const fn of listeners) fn();
}
