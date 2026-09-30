"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Link as LinkIcon, Loader2, Shrink, Unlink } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { cleanName, formatBytes } from "@/lib/format";
import {
  compressBitmap,
  FORMATS,
  loadSource,
  outputName,
  saveBlob,
  targetSize,
  type CompressFormat,
  type CompressOptions,
  type Source,
} from "@/lib/image-compress";
import { ShareDialog } from "./share-folder-button";

type Props = {
  items: MediaItem[];
  /** Selection bar: several photos/folders, compressed into one zip by the gallery. */
  onBatch?: (opts: CompressOptions) => void;
  variant: "lightbox" | "bar";
};

const SIZES = [3840, 2560, 1920, 1280, 1080] as const;
type SizeChoice = "original" | "custom" | `${(typeof SIZES)[number]}`;

type Settings = { format: CompressFormat; quality: number; size: SizeChoice };
const DEFAULTS: Settings = { format: "jpeg", quality: 80, size: "1920" };
const STORAGE_KEY = "smm:compress";

const field =
  "h-9 rounded-md bg-background border border-border px-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50";

/** "Compress" button + dialog: pick format, quality and size, then save a smaller copy. */
export function CompressButton({ items, onBatch, variant }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // The panel (and the decoded photo it holds) only exists while the dialog is open.
  const [open, setOpen] = useState(0);
  const single = items.length === 1 && items[0].kind === "file";
  const photos = items.filter((i) => i.kind === "file" && i.isImage).length;
  const folders = items.filter((i) => i.kind === "folder").length;

  const scope = [photos ? `${photos} ${photos === 1 ? "photo" : "photos"}` : null, folders ? `the photos in ${folders} ${folders === 1 ? "folder" : "folders"}` : null]
    .filter(Boolean)
    .join(" and ");

  return (
    <>
      <button
        type="button"
        title="Compress and download"
        onClick={() => {
          setOpen((n) => n + 1);
          dialog.current?.showModal();
        }}
        className={
          variant === "lightbox"
            ? "h-9 px-2.5 sm:px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
            : "h-9 px-3 rounded-md border border-white/25 text-sm font-medium inline-flex items-center gap-2 hover:bg-white/10"
        }
      >
        <Shrink className="size-4" /> <span className={variant === "lightbox" ? "hidden sm:inline" : ""}>Compress</span>
      </button>

      <ShareDialog
        ref={dialog}
        onClose={() => setOpen(0)}
        title={single ? `Compress “${items[0].name}”` : `Compress ${scope}`}
        description={
          single
            ? "Save a smaller copy. The original in OneDrive isn't changed."
            : "Each photo is compressed with these settings and saved in one zip. Videos and other files are left out."
        }
      >
        {open > 0 &&
          (single ? (
            <SinglePanel key={open} item={items[0]} />
          ) : (
            <BatchPanel
              key={open}
              onStart={(opts) => {
                dialog.current?.close();
                onBatch?.(opts);
              }}
            />
          ))}
      </ShareDialog>
    </>
  );
}

function useSettings() {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Settings> | null;
      return { ...DEFAULTS, ...saved };
    } catch {
      return DEFAULTS;
    }
  });
  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage blocked: the settings still apply for this visit.
      }
      return next;
    });
  return [settings, update] as const;
}

function Controls(props: { settings: Settings; update: (p: Partial<Settings>) => void; allowCustom: boolean; children?: React.ReactNode }) {
  const { settings, update, allowCustom, children } = props;
  const size = !allowCustom && settings.size === "custom" ? "original" : settings.size;
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-medium mb-1.5">Format</p>
        <div role="group" aria-label="Format" className="inline-flex rounded-md border border-border bg-background p-0.5">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={settings.format === f.value}
              onClick={() => update({ format: f.value })}
              className={`h-8 px-4 rounded-[5px] text-sm ${
                settings.format === f.value ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium flex justify-between mb-1.5">
          Quality
          <span className="tabular-nums text-subtle font-normal">
            {settings.format === "png" ? "Lossless" : `${settings.quality}%`}
          </span>
        </span>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={settings.quality}
          disabled={settings.format === "png"}
          onChange={(e) => update({ quality: Number(e.target.value) })}
          className="w-full accent-[var(--foreground)] disabled:opacity-40"
        />
        {settings.format === "png" && (
          <span className="text-xs text-subtle">PNG is lossless, so only resizing makes it smaller. Photos are usually far smaller as JPG or WebP.</span>
        )}
      </label>

      <div>
        <label className="block">
          <span className="text-sm font-medium block mb-1.5">Size</span>
          <select value={size} onChange={(e) => update({ size: e.target.value as SizeChoice })} className={`${field} w-full`}>
            <option value="original">Original size</option>
            {SIZES.map((s) => (
              <option key={s} value={String(s)}>
                {s} px on the longest side
              </option>
            ))}
            {allowCustom && <option value="custom">Custom width and height</option>}
          </select>
        </label>
        {children}
      </div>
    </div>
  );
}

const toOptions = (s: Settings, custom?: { w: number; h: number }): CompressOptions => ({
  format: s.format,
  quality: s.quality / 100,
  maxSide: s.size === "original" || s.size === "custom" ? null : Number(s.size),
  ...(s.size === "custom" && custom ? { width: custom.w, height: custom.h } : {}),
});

const MAX_PX = 16384;
const clampPx = (n: number) => Math.min(MAX_PX, Math.max(1, Math.round(n) || 1));

function SinglePanel({ item }: { item: MediaItem }) {
  const [settings, update] = useSettings();
  const [source, setSource] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ w: number; h: number } | null>(null);
  const [lock, setLock] = useState(true);
  // `key` is the settings the result was encoded with: while it differs from the current ones, a new encode is pending.
  const [result, setResult] = useState<{ blob: Blob; url: string; width: number; height: number; key: string } | null>(null);
  const resultUrl = useRef<string | null>(null);

  // Fetch and decode the original once per open; release the bitmap when the dialog closes.
  useEffect(() => {
    const ctrl = new AbortController();
    let loaded: Source | null = null;
    loadSource(item, ctrl.signal)
      .then((s) => {
        loaded = s;
        setSource(s);
        setCustom({ w: s.bitmap.width, h: s.bitmap.height });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => {
      ctrl.abort();
      loaded?.bitmap.close();
    };
  }, [item]);

  // Re-encode shortly after the settings stop changing.
  const opts = toOptions(settings, custom ?? undefined);
  const optsKey = JSON.stringify(opts);
  useEffect(() => {
    if (!source) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const o = JSON.parse(optsKey) as CompressOptions;
        const blob = await compressBitmap(source.bitmap, o);
        if (cancelled) return;
        const { width, height } = targetSize(source.bitmap.width, source.bitmap.height, o);
        if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
        resultUrl.current = URL.createObjectURL(blob);
        setResult({ blob, url: resultUrl.current, width, height, key: optsKey });
        setError(null);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, optsKey]);

  useEffect(
    () => () => {
      if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    },
    [],
  );

  const setWidth = (w: number) =>
    source && setCustom((c) => ({ w: clampPx(w), h: lock ? clampPx((w * source.bitmap.height) / source.bitmap.width) : (c?.h ?? 1) }));
  const setHeight = (h: number) =>
    source && setCustom((c) => ({ h: clampPx(h), w: lock ? clampPx((h * source.bitmap.width) / source.bitmap.height) : (c?.w ?? 1) }));

  const encoding = !!source && !error && result?.key !== optsKey;
  const change = result && source ? Math.round((result.blob.size / source.bytes - 1) * 100) : null;

  return (
    <div className="grid gap-5">
      <Controls settings={settings} update={update} allowCustom>
        {settings.size === "custom" && custom && (
          <div className="flex items-end gap-2 mt-2">
            <label className="flex-1">
              <span className="text-xs text-subtle">Width</span>
              <input type="number" min={1} max={MAX_PX} value={custom.w} onChange={(e) => setWidth(Number(e.target.value))} className={`${field} w-full tabular-nums`} />
            </label>
            <button
              type="button"
              aria-label={lock ? "Unlock aspect ratio" : "Lock aspect ratio"}
              title={lock ? "Aspect ratio locked" : "Aspect ratio unlocked"}
              aria-pressed={lock}
              onClick={() => {
                // Re-locking snaps the height back to the photo's proportions.
                if (!lock && source && custom) {
                  setCustom({ w: custom.w, h: clampPx((custom.w * source.bitmap.height) / source.bitmap.width) });
                }
                setLock(!lock);
              }}
              className="size-9 grid place-items-center rounded-md border border-border hover:border-foreground aria-pressed:bg-muted"
            >
              {lock ? <LinkIcon className="size-4" /> : <Unlink className="size-4" />}
            </button>
            <label className="flex-1">
              <span className="text-xs text-subtle">Height</span>
              <input type="number" min={1} max={MAX_PX} value={custom.h} onChange={(e) => setHeight(Number(e.target.value))} className={`${field} w-full tabular-nums`} />
            </label>
          </div>
        )}
      </Controls>

      <div className="rounded-md border border-border bg-background p-3 flex gap-3 items-center min-h-24">
        {error ? (
          <p className="text-sm text-red-700">{error}</p>
        ) : !source ? (
          <p className="text-sm text-subtle inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Downloading the original…
          </p>
        ) : (
          <>
            <div className="size-20 shrink-0 bg-muted grid place-items-center overflow-hidden">
              {result && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.url} alt="Compressed preview" className="max-w-full max-h-full object-contain" />
              )}
            </div>
            <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 flex-1 min-w-0">
              <dt className="text-subtle">Original</dt>
              <dd className="tabular-nums">
                {formatBytes(source.bytes)}, {source.bitmap.width} × {source.bitmap.height}
              </dd>
              <dt className="text-subtle">Compressed</dt>
              <dd className="tabular-nums inline-flex items-center gap-2">
                {result ? `${formatBytes(result.blob.size)}, ${result.width} × ${result.height}` : "…"}
                {encoding && <Loader2 className="size-3.5 animate-spin text-subtle" />}
              </dd>
              {change !== null && (
                <>
                  <dt className="text-subtle">Change</dt>
                  <dd className={`tabular-nums font-medium ${change > 0 ? "text-red-700" : ""}`}>
                    {change > 0 ? `${change}% larger than the original` : `${Math.abs(change)}% smaller`}
                  </dd>
                </>
              )}
            </dl>
          </>
        )}
      </div>
      {source?.fromPreview && (
        <p className="text-xs text-subtle -mt-3">
          This browser can&apos;t read the original&apos;s format, so the copy is made from a 3840 px preview.
        </p>
      )}

      <button
        type="button"
        disabled={!result || encoding}
        onClick={() => result && saveBlob(result.blob, outputName(cleanName(item.name), settings.format))}
        className="h-10 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <Download className="size-4" /> Download {FORMATS.find((f) => f.value === settings.format)!.label}
      </button>
    </div>
  );
}

function BatchPanel({ onStart }: { onStart: (opts: CompressOptions) => void }) {
  const [settings, update] = useSettings();
  const size = settings.size === "custom" ? { ...settings, size: "original" as const } : settings;
  return (
    <div className="grid gap-5">
      <Controls settings={settings} update={update} allowCustom={false} />
      <button
        type="button"
        onClick={() => onStart(toOptions(size))}
        className="h-10 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-2"
      >
        <Download className="size-4" /> Compress and download zip
      </button>
    </div>
  );
}
