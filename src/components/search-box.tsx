"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type EventOption = { slug: string; title: string };

/**
 * Header search with an event filter: ticked events are sent as repeated `?e=<slug>`. On the results page it shows the
 * current query and filter. The checkboxes stay in the form while the panel is closed, so Enter keeps the filter.
 */
export function SearchBox({ events }: { events: EventOption[] }) {
  const onSearch = usePathname() === "/search";
  const params = useSearchParams();
  const q = onSearch ? (params.get("q") ?? "") : "";
  const fromUrl = onSearch ? params.getAll("e").join(",") : "";

  // Ticked slugs, reset to the URL's filter whenever that changes (e.g. after a search).
  const [seed, setSeed] = useState(fromUrl);
  const [picked, setPicked] = useState(() => new Set(fromUrl.split(",").filter(Boolean)));
  if (seed !== fromUrl) {
    setSeed(fromUrl);
    setPicked(new Set(fromUrl.split(",").filter(Boolean)));
  }

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);

  // Close on clicking outside or pressing Escape, as in the user menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (slug: string, on: boolean) =>
    setPicked((p) => {
      const next = new Set(p);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  const count = events.filter((e) => picked.has(e.slug)).length;
  const filterable = events.length > 1;

  return (
    <form ref={ref} action="/search" onSubmit={() => setOpen(false)} className="flex-1 max-w-xl ml-auto relative">
      <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
      <input
        key={q}
        name="q"
        type="search"
        defaultValue={q}
        placeholder="Search by file or folder name"
        aria-label="Search files and folders"
        className={`w-full h-9 rounded-md bg-background border border-transparent focus:border-foreground focus:bg-surface pl-9 ${filterable ? "pr-11" : "pr-3"} text-sm outline-none placeholder:text-subtle`}
      />

      {filterable && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-label={count ? `Filter by event, ${count} selected` : "Filter by event"}
            title="Filter by event"
            className={`absolute right-1 top-1/2 -translate-y-1/2 h-7 min-w-7 px-1.5 rounded-[5px] inline-flex items-center justify-center gap-1 text-xs ${count ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground hover:bg-surface"}`}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {count > 0 && <span>{count}</span>}
          </button>

          <div
            role="dialog"
            aria-label="Filter by event"
            hidden={!open}
            className="absolute right-0 top-full mt-2 w-72 rounded-lg border border-border bg-surface shadow-lg z-40"
          >
            <div className="px-3.5 pt-3 pb-1.5 text-sm font-medium">Search in events</div>
            <ul className="max-h-72 overflow-y-auto pb-1.5">
              {events.map((e) => (
                <li key={e.slug}>
                  <label className="h-9 px-3.5 flex items-center gap-3 text-sm cursor-pointer hover:bg-background">
                    <input
                      type="checkbox"
                      name="e"
                      value={e.slug}
                      checked={picked.has(e.slug)}
                      onChange={(ev) => toggle(e.slug, ev.currentTarget.checked)}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                    <span className="min-w-0 truncate">{e.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2 border-t border-border px-3.5 py-2.5">
              <span className="text-xs text-subtle">{count ? `${count} of ${events.length} selected` : "All events"}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPicked(new Set())}
                  disabled={!count}
                  className="h-8 px-2.5 rounded-md text-sm text-subtle hover:text-foreground disabled:opacity-40"
                >
                  Clear
                </button>
                <button type="submit" className="h-8 px-3 rounded-md text-sm bg-accent text-accent-foreground hover:opacity-90">
                  Search
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </form>
  );
}
