"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Film, Loader2 } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { downloadHref, streamHref } from "@/lib/format";
import { BUSY_MESSAGE } from "@/lib/fetch-retry";

type State = "loading" | "ready" | "unsupported" | "busy" | "error";

/**
 * Lightbox player for MXF camera originals. Browsers can't open MXF, so lib/mxf/player.ts reads the file
 * from OneDrive in ranges and remuxes it for the <video> element (no transcoding). The engine is loaded
 * only when an MXF is opened.
 */
export function MxfPlayer({ item, onEnded }: { item: MediaItem; onEnded?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<State>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const controller = new AbortController();
    let playback: { destroy(): void } | null = null;
    // A fresh pre-authenticated OneDrive URL; `stream` keeps it out of the download counts.
    const source = async () => {
      const res = await fetch(`${streamHref(item)}&json=1`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Couldn't get the video link (${res.status})`);
      return ((await res.json()) as { url: string }).url;
    };
    const fail = (e: unknown) => {
      if (controller.signal.aborted) return;
      const name = (e as Error)?.name;
      console.warn("MXF playback:", e);
      setState(name === "UnsupportedError" ? "unsupported" : name === "BusyError" ? "busy" : "error");
    };
    // Without MediaSource at all (older iPhones), open() throws UnsupportedError too.
    import("@/lib/mxf/player")
      .then(({ MxfPlayback }) => MxfPlayback.open(el, source, item.size, fail, controller.signal))
      .then((p) => {
        if (controller.signal.aborted) p.destroy();
        else playback = p;
      })
      .catch(fail);
    const ready = () => setState((s) => (s === "loading" ? "ready" : s));
    el.addEventListener("playing", ready);
    el.addEventListener("loadeddata", ready);
    return () => {
      controller.abort();
      playback?.destroy();
      el.removeEventListener("playing", ready);
      el.removeEventListener("loadeddata", ready);
    };
  }, [item, attempt]);

  const failed = state === "unsupported" || state === "busy" || state === "error";
  return (
    <div className="absolute inset-0 flex items-center justify-center px-2 sm:px-16 py-2">
      <video ref={video} controls autoPlay onEnded={onEnded} className={`max-h-full max-w-full rounded ${failed ? "hidden" : ""}`} />
      {state === "loading" && (
        <span className="absolute top-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Loading video…
        </span>
      )}
      {failed && (
        <div className="flex flex-col items-center gap-3 text-white/70 text-center max-w-sm">
          <Film className="size-12" strokeWidth={1.5} />
          <p>
            {state === "unsupported"
              ? "This camera format plays in Chrome or Edge on a computer. You can still download the original."
              : state === "busy"
                ? BUSY_MESSAGE
                : "The video couldn't be played."}
          </p>
          <div className="flex gap-2">
            {state !== "unsupported" && (
              <button
                onClick={() => {
                  setState("loading");
                  setAttempt((n) => n + 1);
                }}
                className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm"
              >
                Retry
              </button>
            )}
            <a href={downloadHref(item)} className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2">
              <Download className="size-4" /> Download original
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
