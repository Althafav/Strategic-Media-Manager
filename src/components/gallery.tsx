"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { Check, Download, FileText, Folder, Play, X } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { browseHref, cleanName, coverSrc, downloadHref, folderHref, formatBytes, itemKey, type Ref } from "@/lib/format";
import { downloadAsZip, type ZipProgress } from "@/lib/zip-download";
import { Lightbox } from "./lightbox";
import { ShareItemsButton } from "./share-items-button";

type Props = {
  path: string[];
  /** The folder being shown (enables "Download folder"); omitted for search results. */
  folder?: Ref;
  /** What "Download all" zips when there's no folder, e.g. the picked items of a share link. */
  downloadAll?: Ref[];
  /** Team pages: show "Share" for the selection. */
  canShare?: boolean;
  /** Base URL for subfolder links, e.g. `/s/<token>/<path>` on share pages. Defaults to the event's browse URL. */
  base?: string;
  folderName: string;
  items: MediaItem[];
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function Gallery({ path, folder, downloadAll, canShare, base, folderName, items }: Props) {
  const folders = useMemo(() => items.filter((i) => i.kind === "folder"), [items]);
  const files = useMemo(() => items.filter((i) => i.kind === "file"), [items]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const lastClicked = useRef<number | null>(null);
  const zip = useZip();

  const selecting = selected.size > 0;
  const selectedItems = items.filter((i) => selected.has(itemKey(i)));
  const selectedBytes = selectedItems.reduce((n, i) => n + i.size, 0);

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
    [],
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
    files.length ? plural(files.length, "file", "files") : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 py-4">
        <p className="text-sm text-subtle tabular-nums">{summary}</p>
        <div className="ml-auto flex gap-2">
          {files.length > 0 && (
            <button
              className="h-9 px-3 rounded-md border border-border bg-surface text-sm hover:border-foreground"
              onClick={() => setSelected(selecting ? new Set() : new Set(files.map(itemKey)))}
            >
              {selecting ? "Clear selection" : "Select all files"}
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
                </p>
                {canShare && (
                  <ShareItemsButton items={selectedItems} folderId={folder?.id} folderPath={path} folderName={folder ? folderName : undefined} />
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

      {open !== null && <Lightbox items={files} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </>
  );
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
