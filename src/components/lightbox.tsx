"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  FolderOpen,
  ImageOff,
  Info,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  X,
} from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { browseHref, cleanName, downloadHref, formatBytes, resizedPreview, streamHref } from "@/lib/format";
import { ShareItemsButton } from "./share-items-button";

/** Team pages pass where "Share" links are created from; share-link visitors can't share. */
export type LightboxShare = { folderId?: string; folderPath: string[] };

type Props = {
  items: MediaItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  share?: LightboxShare;
};

type ZoomCommand = "toggle" | "in" | "out" | "reset";

const SLIDE_MS = 4000;
const INFO_KEY = "smm:lightbox-info";

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function Lightbox({ items, index, onIndex, onClose, share }: Props) {
  const item = items[index];
  const root = useRef<HTMLDivElement>(null);
  const zoom = useRef<((cmd: ZoomCommand) => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  // Only rendered after a click, never on the server, so reading storage here can't cause a hydration mismatch.
  const [info, setInfo] = useState(() => {
    try {
      return localStorage.getItem(INFO_KEY) === "1";
    } catch {
      return false;
    }
  });

  const count = items.length;
  const go = useCallback((step: number) => onIndex((index + step + count) % count), [index, count, onIndex]);

  const toggleInfo = () =>
    setInfo((on) => {
      try {
        localStorage.setItem(INFO_KEY, on ? "0" : "1");
      } catch {
        // Storage blocked: the panel still toggles for this visit.
      }
      return !on;
    });

  const canFullscreen = typeof document !== "undefined" && document.fullscreenEnabled;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else root.current?.requestFullscreen().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Leave keys alone while the share dialog or a form field is in use.
      const target = e.target instanceof Element ? e.target : null;
      if (document.querySelector("dialog[open]") || target?.closest("input, textarea, select")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowLeft":
          go(-1);
          break;
        case "ArrowRight":
          go(1);
          break;
        case " ":
          if (target?.tagName === "VIDEO") return; // the player's own play/pause
          if (count > 1) setPlaying((p) => !p);
          break;
        case "i":
        case "I":
          toggleInfo();
          break;
        case "z":
        case "Z":
          zoom.current?.("toggle");
          break;
        case "+":
        case "=":
          zoom.current?.("in");
          break;
        case "-":
          zoom.current?.("out");
          break;
        case "0":
          zoom.current?.("reset");
          break;
        case "f":
        case "F":
          if (canFullscreen) toggleFullscreen();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  });

  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, []);

  // Slideshow: photos advance on a timer, videos when they finish (see onEnded below).
  useEffect(() => {
    if (!playing || item.isVideo) return;
    const timer = setTimeout(() => go(1), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [playing, item, go]);

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
    item.takenAt ? dateTimeFmt.format(new Date(item.takenAt)) : null,
  ].filter(Boolean);

  const iconButton = "size-9 grid place-items-center rounded-md hover:bg-white/10 aria-pressed:bg-white/15";

  return (
    <div ref={root} role="dialog" aria-modal aria-label={item.name} className="fixed inset-0 z-50 bg-black/95 text-white flex flex-col">
      <div className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-4 h-14 shrink-0">
        <div className="min-w-0 flex-1 pl-2">
          <p className="text-sm font-medium truncate">{item.name}</p>
          <p className="text-xs text-white/60 truncate flex gap-3">
            {meta.map((m) => (
              <span key={m}>{m}</span>
            ))}
          </p>
        </div>
        <span className="text-xs text-white/60 tabular-nums px-1">
          {index + 1} / {count}
        </span>
        {share && <ShareItemsButton items={[item]} folderId={share.folderId} folderPath={share.folderPath} />}
        {item.location && (
          <Link
            href={browseHref(item.event, item.location)}
            title={item.location.map(cleanName).join(" / ") || "Events"}
            className="h-9 px-2.5 sm:px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
          >
            <FolderOpen className="size-4" /> <span className="hidden sm:inline">Open folder</span>
          </Link>
        )}
        <a
          href={downloadHref(item)}
          title="Download original"
          className="h-9 px-2.5 sm:px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2"
        >
          <Download className="size-4" /> <span className="hidden sm:inline">Download</span>
        </a>
        {count > 1 && (
          <button
            aria-label={playing ? "Pause slideshow" : "Play slideshow"}
            title={playing ? "Pause slideshow (Space)" : "Slideshow (Space)"}
            aria-pressed={playing}
            onClick={() => setPlaying((p) => !p)}
            className={iconButton}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
        )}
        <button aria-label="Details" title="Details (I)" aria-pressed={info} onClick={toggleInfo} className={iconButton}>
          <Info className="size-4" />
        </button>
        {canFullscreen && (
          <button
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            title={fullscreen ? "Exit full screen (F)" : "Full screen (F)"}
            onClick={toggleFullscreen}
            className={`${iconButton} hidden sm:grid`}
          >
            {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
        )}
        <button aria-label="Close" title="Close (Esc)" onClick={onClose} className={iconButton}>
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <div className="relative flex-1 min-h-0">
          <Media
            key={`${item.event}/${item.id}`}
            item={item}
            zoomRef={zoom}
            onZoomed={() => setPlaying(false)}
            onSwipe={go}
            onClose={onClose}
            onEnded={playing ? () => go(1) : undefined}
          />
          {count > 1 && (
            <>
              <NavButton side="left" onClick={() => go(-1)} />
              <NavButton side="right" onClick={() => go(1)} />
            </>
          )}
          {playing && (
            // Restarts with each photo, so it shows time until the next one.
            <div key={index} className="absolute bottom-0 inset-x-0 h-0.5 bg-white/10" aria-hidden>
              <div className="h-full bg-white/60 slideshow-progress" style={{ animationDuration: `${SLIDE_MS}ms` }} />
            </div>
          )}
        </div>
        {info && <InfoPanel item={item} />}
      </div>
    </div>
  );
}

function InfoPanel({ item }: { item: MediaItem }) {
  const megapixels = item.isImage && item.width && item.height ? ` (${((item.width * item.height) / 1e6).toFixed(1)} MP)` : "";
  const rows: [string, React.ReactNode][] = [
    ["Name", item.name],
    ["Taken", item.takenAt && dateTimeFmt.format(new Date(item.takenAt))],
    ["Camera", item.camera],
    ["Dimensions", item.width && item.height ? `${item.width} × ${item.height}${megapixels}` : null],
    ["Size", formatBytes(item.size)],
    ["Type", item.mime],
    ["Modified", item.modifiedAt && dateTimeFmt.format(new Date(item.modifiedAt))],
    [
      "Folder",
      item.location && (
        <Link href={browseHref(item.event, item.location)} className="underline underline-offset-4 decoration-white/40 hover:decoration-white">
          {item.location.map(cleanName).join(" / ") || "Event root"}
        </Link>
      ),
    ],
  ];
  const shortcuts: [string, string][] = [
    ["← →", "Previous / next"],
    ["Space", "Slideshow"],
    ["Z", "Zoom in / out"],
    ["+ − 0", "Zoom step / reset"],
    ["I", "Details"],
    ["F", "Full screen"],
    ["Esc", "Close"],
  ];
  return (
    <aside
      aria-label="Details"
      className="md:w-80 max-h-[40%] md:max-h-none shrink-0 overflow-y-auto border-t md:border-t-0 md:border-l border-white/10 bg-neutral-950 p-5 text-sm"
    >
      <dl className="grid gap-3">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-white/50">{label}</dt>
              <dd className="mt-0.5 break-words">{value}</dd>
            </div>
          ))}
      </dl>
      <dl className="hidden md:grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 mt-8 pt-5 border-t border-white/10 text-xs text-white/60">
        {shortcuts.map(([keys, action]) => (
          <div key={keys} className="contents">
            <dt>
              <kbd className="font-sans rounded border border-white/20 px-1.5 py-px text-white/80">{keys}</kbd>
            </dt>
            <dd className="self-center">{action}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

type MediaProps = {
  item: MediaItem;
  zoomRef: React.RefObject<((cmd: ZoomCommand) => void) | null>;
  onZoomed: () => void;
  onSwipe: (step: number) => void;
  onClose: () => void;
  onEnded?: () => void;
};

function Media({ item, zoomRef, onZoomed, onSwipe, onClose, onEnded }: MediaProps) {
  const [state, setState] = useState<"loading" | "loaded" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const center = "absolute inset-0 flex items-center justify-center px-2 sm:px-16 py-2";
  if (item.isVideo) {
    return (
      <div className={center}>
        <video
          src={streamHref(item)}
          poster={item.preview}
          controls
          autoPlay
          onEnded={onEnded}
          className="max-h-full max-w-full rounded"
        />
      </div>
    );
  }
  if (!item.preview) {
    return (
      <div className={`${center} flex-col gap-3 text-white/70`}>
        <FileText className="size-16" />
        <p>No preview available</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={`${center} flex-col gap-3 text-white/70 text-center`}>
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
        <div className={`${center} pointer-events-none`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={item.thumb} alt="" className="size-full object-contain" />
        </div>
      )}
      {state === "loading" && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading full preview…
        </span>
      )}
      <ZoomableImage
        src={src}
        alt={item.name}
        loaded={state === "loaded"}
        onLoad={() => setState("loaded")}
        onError={() => setState("error")}
        zoomRef={zoomRef}
        onZoomed={onZoomed}
        onSwipe={onSwipe}
        onClose={onClose}
      />
    </>
  );
}

type View = { s: number; x: number; y: number };
const MAX_SCALE = 6;
const CLICK_SCALE = 2.5;
const RESET: View = { s: 1, x: 0, y: 0 };

/** Keeps the zoomed image covering the stage: no panning past its edges. */
function clampView(v: View, img: HTMLImageElement | null, stage: HTMLDivElement | null): View {
  if (!img || !stage || v.s <= 1.001) return RESET;
  const mx = Math.max(0, (img.offsetWidth * v.s - stage.clientWidth) / 2);
  const my = Math.max(0, (img.offsetHeight * v.s - stage.clientHeight) / 2);
  return { s: v.s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
}

type ZoomableProps = {
  src: string;
  alt: string;
  loaded: boolean;
  onLoad: () => void;
  onError: () => void;
} & Omit<MediaProps, "item" | "onEnded">;

/**
 * Click (or double-tap) to zoom at that spot, drag to pan, wheel or pinch to zoom, swipe to change photo
 * and swipe down to close. Once zoomed in, a sharper 3840px preview replaces the 1920px one.
 */
function ZoomableImage({ src, alt, loaded, onLoad, onError, zoomRef, onZoomed, onSwipe, onClose }: ZoomableProps) {
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(RESET);
  const [dragging, setDragging] = useState(false);
  const [swipe, setSwipe] = useState<{ x: number; y: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ startX: 0, startY: 0, lastX: 0, lastY: 0, moved: false, touch: false, pinch: 0, lastTap: 0, swipeX: 0, swipeY: 0 });

  const zoomed = view.s > 1;

  /** Sets a new scale, keeping the image point under (clientX, clientY) in place (the stage centre by default). */
  const zoomAt = useCallback((scale: (s: number) => number, clientX?: number, clientY?: number) => {
    setView((v) => {
      const box = stage.current?.getBoundingClientRect();
      if (!box) return v;
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const px = (clientX ?? cx) - cx;
      const py = (clientY ?? cy) - cy;
      const s = Math.min(MAX_SCALE, Math.max(1, scale(v.s)));
      const k = s / v.s;
      return clampView({ s, x: px - k * (px - v.x), y: py - k * (py - v.y) }, img.current, stage.current);
    });
  }, []);

  useEffect(() => {
    zoomRef.current = (cmd) => {
      if (cmd === "reset") setView(RESET);
      else if (cmd === "toggle") zoomAt((s) => (s > 1 ? 1 : CLICK_SCALE));
      else zoomAt((s) => (cmd === "in" ? s * 1.5 : s / 1.5));
    };
    return () => {
      zoomRef.current = null;
    };
  }, [zoomRef, zoomAt]);

  useEffect(() => {
    if (zoomed) onZoomed();
  }, [zoomed, onZoomed]);

  // Wheel zoom needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt((s) => s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX, e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Sharper preview once zoomed in. Its box is pinned to the current size so the swap can't change the layout.
  const hiSrc = resizedPreview(src);
  const [hi, setHi] = useState<{ src: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!zoomed || !hiSrc || hi) return;
    const pre = new Image();
    pre.onload = () => {
      const el = img.current;
      if (el) setHi({ src: hiSrc, w: el.offsetWidth, h: el.offsetHeight });
    };
    pre.src = hiSrc;
    return () => {
      pre.onload = null;
    };
  }, [zoomed, hiSrc, hi]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 1) {
      Object.assign(g, { startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, touch: e.pointerType !== "mouse", swipeX: 0, swipeY: 0 });
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      g.pinch = Math.hypot(a.x - b.x, a.y - b.y);
      g.moved = true;
      setSwipe(null);
    }
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = g.pinch ? d / g.pinch : 1;
      g.pinch = d;
      zoomAt((s) => s * ratio, (a.x + b.x) / 2, (a.y + b.y) / 2);
      return;
    }
    const dx = e.clientX - g.lastX;
    const dy = e.clientY - g.lastY;
    g.lastX = e.clientX;
    g.lastY = e.clientY;
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 6) g.moved = true;
    if (!g.moved) return;
    if (zoomed) {
      setView((v) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, img.current, stage.current));
    } else if (g.touch) {
      g.swipeX = e.clientX - g.startX;
      g.swipeY = Math.max(0, e.clientY - g.startY);
      setSwipe({ x: g.swipeX, y: g.swipeY });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!pointers.current.delete(e.pointerId)) return;
    const g = gesture.current;
    if (pointers.current.size) {
      // One finger left after a pinch: carry on panning from it.
      const [p] = [...pointers.current.values()];
      g.lastX = p.x;
      g.lastY = p.y;
      return;
    }
    setDragging(false);
    if (g.swipeX || g.swipeY) {
      const { swipeX: x, swipeY: y } = g;
      g.swipeX = g.swipeY = 0;
      setSwipe(null);
      if (Math.abs(x) > 60 && Math.abs(x) > y) onSwipe(x < 0 ? 1 : -1);
      else if (y > 120) onClose();
      return;
    }
    if (g.moved || e.type === "pointercancel") return;
    // A click, or on touch screens a double tap, toggles zoom at that spot.
    const toggle = () => zoomAt((s) => (s > 1 ? 1 : CLICK_SCALE), e.clientX, e.clientY);
    if (!g.touch) return toggle();
    const now = Date.now();
    if (now - g.lastTap < 300) {
      g.lastTap = 0;
      toggle();
    } else {
      g.lastTap = now;
    }
  };

  const transform = swipe
    ? `translate(${swipe.x}px, ${swipe.y}px) scale(${1 - Math.min(swipe.y, 300) / 1500})`
    : `translate(${view.x}px, ${view.y}px) scale(${view.s})`;

  return (
    <div
      ref={stage}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      className={`absolute inset-0 flex items-center justify-center overflow-hidden touch-none select-none px-2 sm:px-16 py-2 ${
        zoomed ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={img}
        src={hi?.src ?? src}
        alt={alt}
        draggable={false}
        onLoad={onLoad}
        onError={hi ? () => setHi(null) : onError}
        style={{
          transform,
          transition: dragging ? "none" : "transform 160ms ease-out",
          opacity: loaded ? 1 - (swipe ? Math.min(swipe.y, 300) / 600 : 0) : 0,
          ...(hi ? { width: hi.w, height: hi.h } : {}),
        }}
        className="max-h-full max-w-full object-contain will-change-transform"
      />
    </div>
  );
}

function NavButton({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      aria-label={side === "left" ? "Previous" : "Next"}
      onClick={onClick}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} z-10 size-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center`}
    >
      <Icon className="size-6" />
    </button>
  );
}
