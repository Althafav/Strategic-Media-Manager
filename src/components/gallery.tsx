"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownUp, Check, Download, FileText, Folder, Play, X } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { browseHref, cleanName, coverSrc, downloadHref, folderHref, formatBytes, itemKey, type Ref } from "@/lib/format";
import { getSelection, getServerSelection, setSelection, subscribeSelection, type Selection } from "@/lib/selection-store";
import { downloadAsZip, type ZipProgress } from "@/lib/zip-download";
import { Lightbox } from "./lightbox";
import { ShareItemsButton } from "./share-items-button";

type Props = {
  path: string[];
  /** The folder being shown (enables "Download folder"); omitted for search results. */
  folder?: Ref;
  /** What "Download all" zips when there's no folder, e.g. the picked items of a share link. */
  downloadAll?: Ref[];
  /** Team pages: show "Share" for the selection, and keep the selection while moving between folders. */
  canShare?: boolean;
  /** Base URL for subfolder links, e.g. `/s/<token>/<path>` on share pages. Defaults to the event's browse URL. */
  base?: string;
  folderName: string;
  items: MediaItem[];
  /** Label for the order `items` arrive in when it isn't by name, e.g. "Relevance" for search results. */
  listedOrder?: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Gallery({ path, folder, downloadAll, canShare, base, folderName, items, listedOrder }: Props) {
  const [sort, setSort] = useStoredSort(listedOrder ? "smm:sort:listed" : "smm:sort", listedOrder ? "listed" : "name-asc");
  const [filter, setFilter] = useState<FileKind | "all">("all");
  const allFiles = useMemo(() => items.filter((i) => i.kind === "file"), [items]);
  const folders = useMemo(() => sortItems(items.filter((i) => i.kind === "folder"), sort), [items, sort]);
  const files = useMemo(
    () => sortItems(filter === "all" ? allFiles : allFiles.filter((i) => kindOf(i) === filter), sort),
    [allFiles, filter, sort],
  );
  const kinds = useMemo(() => countKinds(allFiles), [allFiles]);
  const { selected, selectedItems, setSelected } = useSelection(!!canShare, items, path);
  const [open, setOpen] = useState<number | null>(null);
  const lastClicked = useRef<number | null>(null);
  const zip = useZip();

  const selecting = selected.size > 0;
  const selectedBytes = selectedItems.reduce((n, i) => n + i.size, 0);
  const onThisPage = selectedItems.every((s) => items.some((i) => itemKey(i) === itemKey(s)));
  const folderCount = new Set(selectedItems.map((i) => (i.location ?? []).join("/"))).size;
  const allFilesHere = files.length > 0 && files.every((f) => selected.has(itemKey(f)));

  const toggle = useCallback(
    (index: number, list: MediaItem[], range: boolean) => {
      // Read the anchor now: the state updater runs later, after it moves.
      const anchor = range && lastClicked.current !== null && lastClicked.current < list.length ? lastClicked.current : index;
      const from = Math.min(anchor, index);
      const to = Math.max(anchor, index);
      setSelected((prev) => {
        const next = new Set(prev);
        const on = !prev.has(itemKey(list[index]));
        for (let i = from; i <= to; i++) {
          if (on) next.add(itemKey(list[i]));
          else next.delete(itemKey(list[i]));
        }
        return next;
      });
      lastClicked.current = index;
    },
    [setSelected],
  );

  const downloadSelected = () => {
    const only = selectedItems[0];
    if (selectedItems.length === 1 && only.kind === "file") {
      Object.assign(document.createElement("a"), { href: downloadHref(only) }).click();
      return;
    }
    // Keep t/sig: on share pages the manifest only accepts signed items.
    zip.start(
      selectedItems.map(({ event, id, t, sig }) => ({ event, id, t, sig })),
      `${cleanName(folderName)} - ${selected.size} items.zip`,
    );
  };

  const everything = folder ? [folder] : downloadAll;

  const summary = [
    folders.length ? plural(folders.length, "folder", "folders") : null,
    allFiles.length ? plural(allFiles.length, "file", "files") : null,
  ]
    .filter(Boolean)
    .join(", ");

  const changeFilter = (next: FileKind | "all") => {
    setFilter(next);
    lastClicked.current = null;
    // Hidden files would otherwise still be downloaded or shared with the selection.
    if (next !== "all") {
      setSelected((prev) => new Set([...prev].filter((key) => {
        const item = items.find((i) => itemKey(i) === key);
        return !item || item.kind === "folder" || kindOf(item) === next;
      })));
    }
  };

  const changeSort = (next: SortKey) => {
    setSort(next);
    lastClicked.current = null;
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 py-4">
        <p className="text-sm text-subtle tabular-nums">{summary}</p>
        {kinds.length > 1 && (
          <div role="group" aria-label="Show" className="flex rounded-md border border-border bg-surface p-0.5">
            {([["all", allFiles.length], ...kinds] as const).map(([kind, count]) => (
              <button
                key={kind}
                aria-pressed={filter === kind}
                onClick={() => changeFilter(kind)}
                className={`h-7 px-2.5 rounded-[5px] text-sm inline-flex items-center gap-1.5 ${
                  filter === kind ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground"
                }`}
              >
                {KIND_LABELS[kind]}
                <span className={`text-xs tabular-nums ${filter === kind ? "text-accent-foreground/70" : ""}`}>{count}</span>
              </button>
            ))}
          </div>
        )}
        {items.length > 1 && (
          <label className="relative inline-flex items-center">
            <span className="sr-only">Sort by</span>
            <ArrowDownUp className="size-4 absolute left-2.5 text-subtle pointer-events-none" aria-hidden />
            <select
              value={sort}
              onChange={(e) => changeSort(e.target.value as SortKey)}
              className="h-9 pl-8 pr-3 rounded-md border border-border bg-surface text-sm hover:border-foreground cursor-pointer"
            >
              {listedOrder && <option value="listed">{listedOrder}</option>}
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="ml-auto flex gap-2">
          {files.length > 0 && (
            <button
              className="h-9 px-3 rounded-md border border-border bg-surface text-sm hover:border-foreground"
              onClick={() =>
                setSelected((prev) => (allFilesHere ? new Set() : new Set([...prev, ...files.map(itemKey)])))
              }
            >
              {allFilesHere ? "Clear selection" : `Select all ${filter === "all" ? "files" : KIND_LABELS[filter].toLowerCase()}`}
            </button>
          )}
          {everything && items.length > 0 && (
            <button
              className="h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
              onClick={() => zip.start(everything, `${cleanName(folderName)}.zip`)}
              disabled={zip.busy}
            >
              <Download className="size-4" /> {folder ? "Download folder" : "Download all"}
            </button>
          )}
        </div>
      </div>

      {folders.length > 0 && (
        <section className="grid gap-x-4 gap-y-6 grid-cols-[repeat(auto-fill,minmax(210px,1fr))] mb-10">
          {folders.map((f, i) => (
            <FolderCard
              key={itemKey(f)}
              item={f}
              href={
                base ? folderHref(base, [f.name]) : browseHref(f.event, f.location ? [...f.location, f.name] : [...path, f.name])
              }
              selected={selected.has(itemKey(f))}
              onToggle={(range) => toggle(i, folders, range)}
            />
          ))}
        </section>
      )}

      {files.length > 0 && (
        // Contact sheet: frames butt up against each other with hairline gutters.
        <section className="grid gap-[2px] grid-cols-[repeat(auto-fill,minmax(140px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {files.map((f, i) => (
            <FileTile
              key={itemKey(f)}
              item={f}
              selected={selected.has(itemKey(f))}
              onOpen={(e) => (selecting ? toggle(i, files, e.shiftKey) : setOpen(i))}
              onToggle={(range) => toggle(i, files, range)}
            />
          ))}
        </section>
      )}

      {items.length === 0 && (
        <div className="py-24 text-center">
          <p className="display text-3xl">This folder is empty</p>
          <p className="text-subtle mt-2">Photos added to it in OneDrive will show up here.</p>
        </div>
      )}

      {(selecting || zip.progress) && (
        <div className="fixed bottom-4 inset-x-4 z-40 flex justify-center">
          <div className="w-full max-w-2xl rounded-lg bg-foreground text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)] px-4 py-3 flex items-center gap-3">
            {zip.progress && zip.progress.phase !== "done" ? (
              <ZipStatus progress={zip.progress} onCancel={zip.cancel} />
            ) : zip.error ? (
              <p className="text-sm text-red-300 flex-1">{zip.error}</p>
            ) : zip.progress?.phase === "done" && !selecting ? (
              <p className="text-sm flex-1">Download complete: {plural(zip.progress.files, "file", "files")} saved.</p>
            ) : (
              <>
                <p className="flex-1 flex items-baseline gap-2">
                  <span className="display text-2xl text-pencil tabular-nums">{selected.size}</span>
                  <span className="text-sm">selected</span>
                  {selectedBytes > 0 && <span className="text-sm text-white/60">{formatBytes(selectedBytes)}+</span>}
                  {folderCount > 1 && <span className="text-sm text-white/60">from {folderCount} folders</span>}
                </p>
                {canShare && (
                  <ShareItemsButton
                    items={selectedItems}
                    folderId={onThisPage ? folder?.id : undefined}
                    folderPath={path}
                    folderName={folder && onThisPage ? folderName : undefined}
                  />
                )}
                <button
                  className="h-9 px-3 rounded-md bg-pencil text-foreground text-sm font-semibold inline-flex items-center gap-2 hover:brightness-110"
                  onClick={downloadSelected}
                >
                  <Download className="size-4" /> Download
                </button>
              </>
            )}
            <button
              aria-label="Close"
              className="size-9 grid place-items-center rounded-md hover:bg-white/10"
              onClick={() => {
                zip.reset();
                setSelected(new Set());
              }}
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {open !== null && (
        <Lightbox
          items={files}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          share={canShare ? { folderId: folder?.id, folderPath: path } : undefined}
        />
      )}
    </>
  );
}

type FileKind = "photo" | "video" | "other";
type SortKey = "listed" | "name-asc" | "name-desc" | "date-asc" | "date-desc" | "size-desc" | "size-asc";

const KIND_LABELS: Record<FileKind | "all", string> = { all: "All", photo: "Photos", video: "Videos", other: "Other" };

const SORTS: { value: Exclude<SortKey, "listed">; label: string }[] = [
  { value: "name-asc", label: "Name A–Z" },
  { value: "name-desc", label: "Name Z–A" },
  { value: "date-asc", label: "Oldest first" },
  { value: "date-desc", label: "Newest first" },
  { value: "size-desc", label: "Largest first" },
  { value: "size-asc", label: "Smallest first" },
];

const kindOf = (i: MediaItem): FileKind => (i.isVideo ? "video" : i.isImage ? "photo" : "other");

/** The kinds present among the files, with counts, in display order. */
function countKinds(files: MediaItem[]): [FileKind, number][] {
  const counts = new Map<FileKind, number>();
  for (const f of files) counts.set(kindOf(f), (counts.get(kindOf(f)) ?? 0) + 1);
  return (["photo", "video", "other"] as const).filter((k) => counts.has(k)).map((k) => [k, counts.get(k)!]);
}

const byName = (a: MediaItem, b: MediaItem) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Capture time for photos/videos, else last modified. NaN when unknown. */
const timeOf = (i: MediaItem) => Date.parse(i.takenAt ?? i.modifiedAt ?? "");

function sortItems(list: MediaItem[], sort: SortKey): MediaItem[] {
  if (sort === "listed") return list;
  const [field, dir] = sort.split("-");
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    if (field === "date") {
      const x = timeOf(a);
      const y = timeOf(b);
      // Undated items go last in either direction.
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
      if (x !== y && !Number.isNaN(x)) return sign * (x - y);
    } else if (field === "size" && a.size !== b.size) {
      return sign * (a.size - b.size);
    } else if (field === "name") {
      return sign * byName(a, b);
    }
    return byName(a, b);
  });
}

// Sort choice is remembered per browser. useSyncExternalStore keeps the server render on the fallback, so hydration matches.
const SORT_EVENT = "smm:sort-change";
const subscribeSort = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(SORT_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(SORT_EVENT, onChange);
  };
};

function useStoredSort(storageKey: string, fallback: SortKey): [SortKey, (next: SortKey) => void] {
  const stored = useSyncExternalStore(
    subscribeSort,
    () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null,
  );
  const valid = stored === fallback || SORTS.some((s) => s.value === stored);
  const set = (next: SortKey) => {
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      // Storage blocked: the choice still applies until the page changes.
    }
    window.dispatchEvent(new Event(SORT_EVENT));
  };
  const [fallbackChoice, setFallbackChoice] = useState<SortKey | null>(null);
  return [
    valid ? (stored as SortKey) : (fallbackChoice ?? fallback),
    (next) => {
      setFallbackChoice(next);
      set(next);
    },
  ];
}

/** Loose grease-pencil loop drawn around a chosen frame, the way picks are marked on a contact sheet. */
function PencilMark() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-[3px] z-10 size-[calc(100%-6px)] overflow-visible [filter:drop-shadow(0_0_1px_rgba(0,0,0,0.45))]"
    >
      <path
        className="pencil-stroke"
        pathLength={1}
        d="M9 12 C 32 5, 70 4, 92 8 C 96 30, 97 68, 93 92 C 70 97, 30 97, 8 93 C 4 70, 3 36, 6 11 L 17 6"
        fill="none"
        stroke="var(--pencil)"
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function FolderCard(props: { item: MediaItem; href: string; selected: boolean; onToggle: (range: boolean) => void }) {
  const { item, href, selected, onToggle } = props;
  const [hasCover, setHasCover] = useState(true);
  return (
    <div className="group relative">
      <Link href={href} className="block">
        <div className={`relative aspect-[4/3] grid place-items-center overflow-hidden ${selected ? "bg-surface" : "bg-muted"}`}>
          {hasCover && item.childCount ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc(item)}
              alt=""
              loading="lazy"
              onError={() => setHasCover(false)}
              className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[0.86]" : ""}`}
            />
          ) : (
            <Folder className="size-10 text-subtle" strokeWidth={1.5} />
          )}
          {selected && <PencilMark />}
        </div>
        <p className="display text-lg mt-2 truncate group-hover:underline underline-offset-4 decoration-1">
          {cleanName(item.name)}
        </p>
        <p className="text-xs text-subtle truncate">
          {item.location?.length ? `In ${item.location.map(cleanName).join(" / ")}, ` : ""}
          {plural(item.childCount ?? 0, "item", "items")}
        </p>
      </Link>
      <SelectBox selected={selected} onToggle={onToggle} />
    </div>
  );
}

function FileTile(props: {
  item: MediaItem;
  selected: boolean;
  onOpen: (e: React.MouseEvent) => void;
  onToggle: (range: boolean) => void;
}) {
  const { item, selected, onOpen, onToggle } = props;
  return (
    <div className={`group relative aspect-square overflow-hidden ${selected ? "bg-surface" : "bg-muted"}`}>
      <button className="size-full block" onClick={onOpen} aria-label={`Open ${item.name}`}>
        {item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumb}
            alt={item.name}
            loading="lazy"
            decoding="async"
            className={`size-full object-cover transition-transform duration-200 ${selected ? "scale-[0.84]" : ""}`}
          />
        ) : (
          <span className="size-full grid place-items-center text-subtle">
            <FileText className="size-8" strokeWidth={1.5} />
          </span>
        )}
        {item.isVideo && (
          <span className="absolute bottom-2 right-2 size-7 rounded-full bg-foreground/70 grid place-items-center text-white">
            <Play className="size-3.5 fill-current" />
          </span>
        )}
        {/* File name on hover, like the frame caption on a contact sheet. */}
        <span
          className={`absolute inset-x-0 bottom-0 px-2 py-1 bg-foreground/75 text-white text-[11px] text-left truncate transition-opacity ${
            item.thumb ? "opacity-0 group-hover:opacity-100" : "opacity-100"
          } ${selected ? "hidden" : ""}`}
        >
          {item.name}
        </span>
      </button>
      {selected && <PencilMark />}
      <SelectBox selected={selected} onToggle={onToggle} />
    </div>
  );
}

function SelectBox({ selected, onToggle }: { selected: boolean; onToggle: (range: boolean) => void }) {
  return (
    <button
      aria-label={selected ? "Deselect" : "Select"}
      aria-pressed={selected}
      onClick={(e) => onToggle(e.shiftKey)}
      className={`absolute top-2 left-2 z-20 size-6 rounded-full border-2 grid place-items-center transition ${
        selected
          ? "bg-pencil border-pencil text-foreground opacity-100"
          : "border-white bg-foreground/30 text-transparent opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
      }`}
    >
      <Check className="size-3.5" strokeWidth={3} />
    </button>
  );
}

function ZipStatus({ progress, onCancel }: { progress: ZipProgress; onCancel: () => void }) {
  const pct = progress.totalBytes ? Math.min(100, (progress.bytes / progress.totalBytes) * 100) : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between gap-3 text-sm mb-1.5">
        <span className="tabular-nums truncate">
          {progress.phase === "listing"
            ? "Preparing file list…"
            : `Zipping ${plural(progress.files, "file", "files")}: ${formatBytes(progress.bytes)} of ${formatBytes(progress.totalBytes)}`}
        </span>
        <button className="text-white/70 hover:text-white" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="h-1 rounded-full bg-white/15 overflow-hidden">
        <div className="h-full bg-pencil transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * Selected items by key. Team pages keep the selection in the shared store so it carries across folders and
 * search; share pages keep it per page. Items are stored with their folder (`location`) so a later share or
 * download from another page still knows where each one came from.
 */
function useSelection(persist: boolean, items: MediaItem[], path: string[]) {
  const stored = useSyncExternalStore(subscribeSelection, getSelection, getServerSelection);
  const [local, setLocal] = useState<Selection>(new Map());
  const picked = persist ? stored : local;

  const setSelected = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      const rebuild = (prev: Selection) => {
        const next = new Map<string, MediaItem>();
        for (const key of update(new Set(prev.keys()))) {
          const known = prev.get(key);
          const here = items.find((i) => itemKey(i) === key);
          const item = known ?? (here && { ...here, location: here.location ?? path });
          if (item) next.set(key, item);
        }
        return next;
      };
      if (persist) setSelection(rebuild(getSelection()));
      else setLocal(rebuild);
    },
    [persist, items, path],
  );

  return {
    selected: useMemo(() => new Set(picked.keys()), [picked]),
    selectedItems: useMemo(() => [...picked.values()], [picked]),
    setSelected: useCallback(
      (next: Set<string> | ((prev: Set<string>) => Set<string>)) => setSelected(typeof next === "function" ? next : () => next),
      [setSelected],
    ),
  };
}

function useZip() {
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const start = async (items: Ref[], name: string) => {
    controller.current?.abort();
    const ctrl = (controller.current = new AbortController());
    setError(null);
    try {
      await downloadAsZip(items, name, setProgress, ctrl.signal);
    } catch (e) {
      setProgress(null);
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    }
  };

  return {
    progress,
    error,
    busy: !!progress && progress.phase !== "done",
    start,
    cancel: () => controller.current?.abort(),
    reset: () => {
      controller.current?.abort();
      setProgress(null);
      setError(null);
    },
  };
}
