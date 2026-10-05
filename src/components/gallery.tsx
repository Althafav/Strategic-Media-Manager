"use client";

import Link from "next/link";
import { useCallback, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDownUp, Check, Download, FileText, Folder, Heart, Play, X } from "lucide-react";
import { setFolderCoverAction } from "@/app/covers/actions";
import { setLikeAction } from "@/app/likes/actions";
import type { MediaItem } from "@/lib/onedrive/types";
import { browseHref, cleanName, coverSrc, downloadHref, folderHref, formatBytes, itemKey, type Ref } from "@/lib/format";
import { ADMIN_LIKER, type LikeMap, type LikeState } from "@/lib/like-types";
import { getSelection, getServerSelection, setSelection, subscribeSelection, type Selection } from "@/lib/selection-store";
import type { CompressOptions } from "@/lib/image-compress";
import { downloadAsZip, type ZipProgress } from "@/lib/zip-download";
import { CompressButton } from "./compress-dialog";
import { Lightbox } from "./lightbox";
import { RequestItemsButton } from "./request-photos-button";
import { ShareItemsButton } from "./share-items-button";

type Props = {
  path: string[];
  /** The folder being shown (enables "Download folder"); omitted for search results. */
  folder?: Ref;
  /** What "Download all" zips when there's no folder, e.g. the picked items of a share link. */
  downloadAll?: Ref[];
  /** Team pages: show "Share" for the selection, and keep the selection while moving between folders. */
  canShare?: boolean;
  /** Photo details panel in the lightbox (admin only). */
  showDetails?: boolean;
  /** Base URL for subfolder links, e.g. `/s/<token>/<path>` on share pages. Defaults to the event's browse URL. */
  base?: string;
  folderName: string;
  items: MediaItem[];
  /** Label for the order `items` arrive in when it isn't by name, e.g. "Relevance" for search results. */
  listedOrder?: string;
  /** Team pages: like counts keyed by `itemKey`. Omitted on share pages, which hides the like buttons. */
  likes?: LikeMap;
  /** Team pages: download counts keyed by `itemKey` (team and share-link downloads). Omitted on share pages. */
  downloads?: Record<string, number>;
  /** Event pages with a coordinator: their name, which shows "Request" for the selection. */
  requestTo?: string;
  /** Team event pages: picked folder covers (folder id -> item id). */
  covers?: Record<string, string>;
  /** Admin: "Set as cover" in the lightbox picks the open photo as this folder's cover. */
  canSetCover?: boolean;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Gallery({ path, folder, downloadAll, canShare, showDetails, base, folderName, items, listedOrder, likes, downloads, requestTo, covers: initialCovers, canSetCover }: Props) {
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
  const like = useLikes(likes);
  const cover = useCovers(initialCovers, folder);

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

  const compressSelected = (opts: CompressOptions) =>
    zip.start(
      selectedItems.map(({ event, id, t, sig }) => ({ event, id, t, sig })),
      `${cleanName(folderName)} - ${selected.size} items (compressed).zip`,
      opts,
    );
  const canCompress = selectedItems.some((i) => i.kind === "folder" || i.isImage);

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
      {/* Leave room for the selection sidebar so it never covers tiles. */}
      <div className={selecting || zip.progress ? "lg:mr-[19rem]" : undefined}>
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
                coverVersion={cover.version}
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
                like={like.enabled ? like.get(f) : undefined}
                onLike={() => like.toggle(f)}
                downloads={downloads?.[itemKey(f)]}
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
      </div>

      {(selecting || zip.progress) && (
        // Desktop: a sidebar on the right listing every pick. Phones: a bottom sheet with a short scrolling list.
        <aside
          aria-label="Selection"
          className="fixed z-40 inset-x-4 bottom-4 max-h-[70vh] lg:inset-x-auto lg:right-4 lg:top-[4.5rem] lg:w-72 lg:max-h-none flex flex-col rounded-lg bg-foreground text-white shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
        >
          <div className="flex items-center gap-2 pl-4 pr-2 py-2.5 border-b border-white/10">
            {selecting ? (
              <p className="flex-1 min-w-0 flex flex-wrap items-baseline gap-x-2">
                <span className="display text-2xl text-pencil tabular-nums">{selected.size}</span>
                <span className="text-sm">selected</span>
                {selectedBytes > 0 && <span className="text-xs text-white/60">{formatBytes(selectedBytes)}+</span>}
                {folderCount > 1 && <span className="text-xs text-white/60">from {folderCount} folders</span>}
              </p>
            ) : (
              <p className="flex-1 text-sm">Download</p>
            )}
            <button
              aria-label="Clear selection"
              title="Clear selection"
              className="size-8 grid place-items-center rounded-md hover:bg-white/10"
              onClick={() => {
                zip.reset();
                setSelected(new Set());
              }}
            >
              <X className="size-4" />
            </button>
          </div>

          {selecting && (
            <ul className="flex-1 min-h-0 max-h-[30vh] lg:max-h-none overflow-y-auto py-1">
              {selectedItems.map((item) => (
                <SelectedRow
                  key={itemKey(item)}
                  item={item}
                  onRemove={() =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.delete(itemKey(item));
                      return next;
                    })
                  }
                />
              ))}
            </ul>
          )}

          <div className={`p-3 flex flex-wrap gap-2 ${selecting ? "border-t border-white/10" : ""}`}>
            {zip.progress && zip.progress.phase !== "done" ? (
              <ZipStatus progress={zip.progress} onCancel={zip.cancel} />
            ) : zip.error ? (
              <p className="text-sm text-red-300 flex-1">{zip.error}</p>
            ) : zip.progress?.phase === "done" && !selecting ? (
              <p className="text-sm flex-1">
                Download complete: {plural(zip.progress.files, zip.progress.compress ? "photo" : "file", zip.progress.compress ? "photos" : "files")}{" "}
                saved{zip.progress.skipped ? `, ${plural(zip.progress.skipped, "other file", "other files")} left out` : ""}.
              </p>
            ) : (
              <>
                {canShare && (
                  <ShareItemsButton
                    items={selectedItems}
                    folderId={onThisPage ? folder?.id : undefined}
                    folderPath={path}
                    folderName={folder && onThisPage ? folderName : undefined}
                  />
                )}
                {requestTo && folder && <RequestItemsButton event={folder.event} items={selectedItems} folderPath={path} coordinator={requestTo} />}
                {canCompress && <CompressButton items={selectedItems} onBatch={compressSelected} variant="bar" />}
                <button
                  className="h-9 px-3 w-full rounded-md bg-pencil text-foreground text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-110"
                  onClick={downloadSelected}
                >
                  <Download className="size-4" /> Download
                </button>
              </>
            )}
          </div>
        </aside>
      )}

      {open !== null && (
        <Lightbox
          items={files}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          share={canShare ? { folderId: folder?.id, folderPath: path } : undefined}
          showDetails={showDetails}
          like={like.enabled ? like.get(files[open]) : undefined}
          onLike={like.toggle}
          cover={canSetCover && folder && files[open].isImage ? { isCover: cover.isCover(files[open]), onToggle: cover.toggle } : undefined}
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

function FolderCard(props: { item: MediaItem; href: string; selected: boolean; onToggle: (range: boolean) => void; coverVersion?: string }) {
  const { item, href, selected, onToggle, coverVersion } = props;
  const [hasCover, setHasCover] = useState(true);
  return (
    <div className="group relative">
      <Link href={href} className="block">
        <div className={`relative aspect-[4/3] grid place-items-center overflow-hidden ${selected ? "bg-surface" : "bg-muted"}`}>
          {hasCover && item.childCount ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc(item, coverVersion)}
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
  like?: LikeState;
  onLike: () => void;
  downloads?: number;
}) {
  const { item, selected, onOpen, onToggle, like, onLike, downloads } = props;
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
        {/* Download count; makes way for the file name caption on hover. */}
        {!!downloads && !selected && (
          <span
            title={`Downloaded ${downloads} ${downloads === 1 ? "time" : "times"}`}
            className={`absolute bottom-2 left-2 h-6 px-1.5 rounded-full bg-foreground/60 text-white text-xs tabular-nums inline-flex items-center gap-1 transition-opacity ${
              item.thumb ? "group-hover:opacity-0" : "hidden"
            }`}
          >
            <Download className="size-3.5" strokeWidth={2.25} aria-hidden />
            <span className="sr-only">Downloads: </span>
            {downloads}
          </span>
        )}
      </button>
      {selected && <PencilMark />}
      <SelectBox selected={selected} onToggle={onToggle} />
      {like && <LikeBadge like={like} onLike={onLike} />}
    </div>
  );
}

/** Heart + count in the tile corner: always shown once liked, otherwise on hover. The admin also gets who liked it on hover. */
function LikeBadge({ like, onLike }: { like: LikeState; onLike: () => void }) {
  const tipId = useId();
  const likers = like.by?.length ? like.by : null;
  return (
    <div className="group/like absolute top-2 right-2 z-20 flex flex-col items-end max-w-[calc(100%-1rem)]">
      <button
        aria-label={like.mine ? "Unlike" : "Like"}
        aria-pressed={like.mine}
        aria-describedby={likers ? tipId : undefined}
        title={likers ? undefined : like.mine ? "Unlike" : "Like"}
        onClick={onLike}
        className={`h-6 min-w-6 px-1.5 rounded-full bg-foreground/60 text-white text-xs tabular-nums inline-flex items-center justify-center gap-1 transition hover:bg-foreground/80 ${
          like.count > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
        }`}
      >
        <Heart className={`size-3.5 ${like.mine ? "fill-current" : ""}`} strokeWidth={2.25} />
        {like.count > 0 && like.count}
      </button>
      {likers && (
        <div
          id={tipId}
          role="tooltip"
          className="mt-1 rounded-md bg-foreground/85 text-white text-[11px] leading-snug px-2 py-1.5 max-w-full opacity-0 pointer-events-none transition-opacity group-hover/like:opacity-100 group-focus-within/like:opacity-100"
        >
          <p className="text-white/60">Liked by</p>
          {likers.slice(0, MAX_LIKERS).map((name, i) => (
            <p key={i} className="truncate">
              {name}
            </p>
          ))}
          {likers.length > MAX_LIKERS && <p className="text-white/60">+{likers.length - MAX_LIKERS} more</p>}
        </div>
      )}
    </div>
  );
}

/** Names that fit in the tile's tooltip; the lightbox lists them all. */
const MAX_LIKERS = 5;

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

/** One compact line in the selection sidebar: tiny preview, name, and a remove button. */
function SelectedRow({ item, onRemove }: { item: MediaItem; onRemove: () => void }) {
  const name = item.kind === "folder" ? cleanName(item.name) : item.name;
  return (
    <li className="group/row flex items-center gap-2 h-8 pl-3 pr-1.5 hover:bg-white/5">
      <span className="size-6 shrink-0 grid place-items-center overflow-hidden rounded-sm bg-white/10 text-white/70">
        {item.kind === "folder" ? (
          <Folder className="size-3.5" />
        ) : item.thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumb} alt="" loading="lazy" className="size-full object-cover" />
        ) : item.isVideo ? (
          <Play className="size-3 fill-current" />
        ) : (
          <FileText className="size-3.5" />
        )}
      </span>
      <span className="flex-1 min-w-0 truncate text-xs" title={item.name}>
        {name}
      </span>
      <button
        aria-label={`Remove ${name}`}
        title="Remove"
        onClick={onRemove}
        className="size-6 shrink-0 grid place-items-center rounded text-white/50 hover:text-white hover:bg-white/10"
      >
        <X className="size-3" />
      </button>
    </li>
  );
}

function ZipStatus({ progress, onCancel }: { progress: ZipProgress; onCancel: () => void }) {
  const pct = progress.compress
    ? progress.totalFiles ? (progress.files / progress.totalFiles) * 100 : 0
    : progress.totalBytes ? Math.min(100, (progress.bytes / progress.totalBytes) * 100) : 0;
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between gap-3 text-sm mb-1.5">
        <span className="tabular-nums truncate">
          {progress.phase === "listing"
            ? "Preparing file list…"
            : progress.compress
              ? `Compressing ${progress.files} of ${plural(progress.totalFiles ?? 0, "photo", "photos")}`
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

/** Like counts from the server plus this visitor's changes since, saved optimistically. */
function useLikes(initial: LikeMap | undefined) {
  const [changed, setChanged] = useState<LikeMap>({});
  const get = (r: Ref): LikeState => changed[itemKey(r)] ?? initial?.[itemKey(r)] ?? { count: 0, mine: false };
  const toggle = async (item: MediaItem) => {
    const key = itemKey(item);
    const before = get(item);
    const wanted = !before.mine;
    // Only the admin's likes carry `by`, so the optimistic entry is theirs.
    const by = before.by && (wanted ? [...before.by, ADMIN_LIKER] : before.by.filter((n) => n !== ADMIN_LIKER));
    setChanged((m) => ({ ...m, [key]: { count: Math.max(0, before.count + (wanted ? 1 : -1)), mine: wanted, by } }));
    const result = await setLikeAction(item.event, item.id, wanted).catch(() => ({ error: "Could not save the like." }));
    if ("error" in result) {
      setChanged((m) => ({ ...m, [key]: before }));
      alert(result.error);
    } else {
      setChanged((m) => ({ ...m, [key]: result }));
    }
  };
  return { enabled: !!initial, get, toggle };
}

/** Picked folder covers; `version` changes with them so folder tiles refetch instead of reusing a cached cover. */
function useCovers(initial: Record<string, string> | undefined, folder: Ref | undefined) {
  const [covers, setCovers] = useState(initial ?? {});
  const version = useMemo(() => {
    const s = Object.entries(covers).sort().join(",");
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
    return s ? (h >>> 0).toString(36) : undefined;
  }, [covers]);
  const isCover = (item: MediaItem) => !!folder && covers[folder.id] === item.id;
  const toggle = async (item: MediaItem) => {
    if (!folder) return;
    const before = covers;
    const next = isCover(item) ? null : item.id;
    const rest = Object.fromEntries(Object.entries(covers).filter(([k]) => k !== folder.id));
    setCovers(next ? { ...rest, [folder.id]: next } : rest);
    const result = await setFolderCoverAction(folder.event, folder.id, next).catch(() => ({ error: "Could not save the cover." }));
    if (result.error) {
      setCovers(before);
      alert(result.error);
    }
  };
  return { version, isCover, toggle };
}

function useZip() {
  const [progress, setProgress] = useState<ZipProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const start = async (items: Ref[], name: string, compress?: CompressOptions) => {
    controller.current?.abort();
    const ctrl = (controller.current = new AbortController());
    setError(null);
    try {
      await downloadAsZip(items, name, setProgress, ctrl.signal, compress);
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
