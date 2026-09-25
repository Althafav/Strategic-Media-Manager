"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileText, FolderOpen, ImageOff, Loader2, X } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { browseHref, cleanName, downloadHref, formatBytes } from "@/lib/format";

type Props = { items: MediaItem[]; index: number; onIndex: (i: number) => void; onClose: () => void };

export function Lightbox({ items, index, onIndex, onClose }: Props) {
  const item = items[index];
  const prev = () => onIndex((index - 1 + items.length) % items.length);
  const next = () => onIndex((index + 1) % items.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  // Warm the neighbours so arrowing feels instant.
  useEffect(() => {
    for (const i of [index + 1, index - 1]) {
      const n = items[(i + items.length) % items.length];
      if (n?.preview) new Image().src = n.preview;
    }
  }, [index, items]);

  const meta = [
    item.width && item.height ? `${item.width} × ${item.height}` : null,
    formatBytes(item.size),
    item.takenAt ? new Date(item.takenAt).toLocaleString() : null,
    item.camera,
  ].filter(Boolean);

  return (
    <div role="dialog" aria-modal aria-label={item.name} className="fixed inset-0 z-50 bg-black/95 text-white flex flex-col">
      <div className="flex items-center gap-3 px-4 h-14 shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-white/60 truncate flex gap-3">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </p>
        </div>
        <span className="text-xs text-white/60 tabular-nums">
          {index + 1} / {items.length}
        </span>
        {item.location && (
          <Link
            href={browseHref(item.event, item.location)}
            title={item.location.map(cleanName).join(" / ") || "Events"}
            className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
          >
            <FolderOpen className="size-4" /> <span className="hidden sm:inline">Open folder</span>
          </Link>
        )}
        <a
          href={downloadHref(item)}
          className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
        >
          <Download className="size-4" /> Download
        </a>
        <button aria-label="Close" onClick={onClose} className="size-9 grid place-items-center rounded-md hover:bg-white/10">
          <X className="size-5" />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-16 pb-4">
        <Media key={`${item.event}/${item.id}`} item={item} />
        {items.length > 1 && (
          <>
            <NavButton side="left" onClick={prev} />
            <NavButton side="right" onClick={next} />
          </>
        )}
      </div>
    </div>
  );
}

function Media({ item }: { item: MediaItem }) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  if (item.isVideo) {
    return (
      <video
        src={downloadHref(item)}
        poster={item.preview}
        controls
        autoPlay
        className="max-h-full max-w-full rounded"
      />
    );
  }
  if (!item.preview) {
    return (
      <div className="flex flex-col items-center gap-3 text-white/70">
        <FileText className="size-16" />
        <p>No preview available</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="flex flex-col items-center gap-3 text-white/70 text-center">
        <ImageOff className="size-12" />
        <p>Preview couldn&apos;t be loaded from OneDrive.</p>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setState("loading");
              setAttempt((n) => n + 1);
            }}
            className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm"
          >
            Retry
          </button>
          <a href={downloadHref(item)} className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2">
            <Download className="size-4" /> Download original
          </a>
        </div>
      </div>
    );
  }
  const src = attempt ? `${item.preview}${item.preview.includes("?") ? "&" : "?"}r=${attempt}` : item.preview;
  return (
    <>
      {/* Low-res thumb (usually already cached from the grid) shows while the large preview loads. */}
      {state === "loading" && item.thumb && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.thumb}
          alt=""
          className="absolute inset-0 m-auto max-h-[calc(100vh-5.5rem)] max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-8rem)] size-full object-contain"
        />
      )}
      {state === "loading" && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading full preview…
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={src}
        src={src}
        alt={item.name}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        className={`relative max-h-[calc(100vh-5.5rem)] max-w-full object-contain select-none transition-opacity ${
          state === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} size-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center`}
    >
      <Icon className="size-6" />
    </button>
  );
}
