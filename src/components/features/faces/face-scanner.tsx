"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pause, Play, ScanFace } from "lucide-react";
import { faceScanQueueAction, nextUnscannedAction, saveFacesAction } from "@/app/faces/actions";
import { packEmbedding, type ScanResult } from "@/lib/face-types";
import { SCAN_EVENT } from "@/lib/face-scan-event";
import { BusyError, fetchRetry } from "@/lib/fetch-retry";
import { decode } from "@/lib/image-compress";
import type { MediaItem } from "@/lib/onedrive/types";

/** With nothing left to scan, how often to look for new photos (the nightly sync, other people's "Sync now"). */
const IDLE_MS = 5 * 60_000;
/** After OneDrive throttles the previews. */
const BUSY_MS = 2 * 60_000;
/** Let the page finish loading before the models (tens of MB) and previews start downloading. */
const START_MS = 4000;
/** Save after this many photos, or this many faces (server actions take 1 MB). */
const SAVE_EVERY = 6;
const SAVE_FACES = 100;
/** Previews downloaded ahead while the current photo is scanned (each takes ~1 s from OneDrive). */
const PREFETCH = 3;
const PAUSE_KEY = "smm:face-scan-paused";

const n = (v: number) => v.toLocaleString("en-GB");

/** One photo's 1920 px preview (the original is never fetched), or its result when it can't be read. */
async function load(item: MediaItem, signal: AbortSignal): Promise<ImageBitmap | ScanResult> {
  if (!item.preview) return { id: item.id, faces: [], failed: true };
  try {
    const blob = await fetchRetry(
      () => item.preview!,
      (res) => (res.ok ? res.blob() : Promise.reject(new Error(`preview ${res.status}`))),
      signal,
    );
    if (!blob) return { id: item.id, faces: [], failed: true };
    return await decode(blob);
  } catch (e) {
    // Throttled or stopped: end the run and try again later. Anything else: this photo can't be read.
    if (e instanceof BusyError || signal.aborted) throw e;
    return { id: item.id, faces: [], failed: true };
  }
}

async function scan(item: MediaItem, loaded: ImageBitmap | ScanResult): Promise<ScanResult> {
  if (!(loaded instanceof ImageBitmap)) return loaded;
  const { detectFaces } = await import("@/lib/faces");
  const faces = await detectFaces(loaded, { tiles: true });
  return { id: item.id, faces: faces.map((f) => ({ embedding: packEmbedding(f.embedding), box: f.box })) };
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

type Progress = { title: string; left: number; msPerPhoto?: number };

/** "about 2 h left", "about 12 min left", "under a minute left". */
function timeLeft(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "under a minute left";
  if (mins < 90) return `about ${mins} min left`;
  return `about ${Math.round(mins / 60)} h left`;
}

/**
 * Keeps every event's face index up to date in the background while the admin has the app open: photos not
 * scanned yet are fetched as previews, their faces turned into embeddings in this browser (lib/faces.ts), and
 * only those are saved. Runs after each "Sync now" and checks for new photos every few minutes. One tab scans
 * at a time. Shows as a small status in the header; nothing when there is no work.
 */
export function FaceScanner() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [note, setNote] = useState<string>();
  const [paused, setPaused] = useState(false);
  const wake = useRef<() => void>(() => {});

  useEffect(() => {
    try {
      // Read after mount: the server can't know it, and reading during render would mismatch at hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(PAUSE_KEY) === "1") setPaused(true);
    } catch {
      // Storage blocked: scanning just starts unpaused.
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    const ctl = new AbortController();
    const { signal } = ctl;

    // Pace of this run (photos saved, time spent on them, downloads included), for the time-left estimate.
    let done = 0;
    let spent = 0;
    const pace = () => (done >= 6 ? spent / done : undefined);

    /** Scans everything waiting, event by event. Returns when nothing is left (or the run was stopped). */
    const drain = async () => {
      for (;;) {
        const queue = (await faceScanQueueAction()).events ?? [];
        if (signal.aborted || !queue.length) return;
        // The first event that hands out photos. (Counts can run ahead of the index for a moment.)
        let event = queue[0];
        let items: MediaItem[] = [];
        for (const e of queue) {
          const next = await nextUnscannedAction(e.slug);
          if (next.error) throw new Error(next.error);
          if (next.items?.length) {
            event = e;
            items = next.items;
            break;
          }
        }
        if (signal.aborted || !items.length) return;
        let left = queue.reduce((t, e) => t + e.left, 0);
        setNote(undefined);
        setProgress({ title: event.title, left, msPerPhoto: pace() });
        const { loadFaces } = await import("@/lib/faces");
        await loadFaces({ gpu: true });
        let batchStart = performance.now();

        let pending: ScanResult[] = [];
        const flush = async () => {
          if (!pending.length) return;
          const batch = pending;
          pending = [];
          const res = await saveFacesAction(event.slug, batch);
          if (res.error) throw new Error(res.error);
          left = Math.max(0, left - batch.length);
          done += batch.length;
          spent += performance.now() - batchStart;
          batchStart = performance.now();
          setProgress({ title: event.title, left, msPerPhoto: pace() });
        };

        const loads: Promise<ImageBitmap | ScanResult>[] = [];
        try {
          for (let i = 0; i < items.length && !signal.aborted; i++) {
            while (loads.length < Math.min(i + PREFETCH, items.length)) {
              const l = load(items[loads.length], signal);
              l.catch(() => {}); // handled when its turn comes
              loads.push(l);
            }
            pending.push(await scan(items[i], await loads[i]));
            if (pending.length >= SAVE_EVERY || pending.reduce((t, r) => t + r.faces.length, 0) >= SAVE_FACES) await flush();
          }
        } finally {
          // Frees previews downloaded ahead but not scanned (stopped or failed); scanned ones are already closed.
          for (const l of loads) l.then((r) => r instanceof ImageBitmap && r.close(), () => {});
        }
        await flush();
      }
    };

    const loop = async () => {
      await sleep(START_MS, signal);
      while (!signal.aborted) {
        let wait = IDLE_MS;
        try {
          await drain();
          setNote(undefined);
        } catch (e) {
          if (signal.aborted) break;
          wait = BUSY_MS;
          setNote(e instanceof BusyError ? "OneDrive is busy. Face scan continues in 2 minutes." : `Face scan stopped: ${(e as Error).message}`);
        }
        setProgress(null);
        // Sleep until the next check, or until something asks for a scan.
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, wait);
          wake.current = done;
          signal.addEventListener("abort", done, { once: true });
        });
      }
    };

    // One tab scans at a time; the others wait their turn (and take over if that tab closes).
    if (navigator.locks) void navigator.locks.request("smm-face-scan", { signal }, loop).catch(() => {});
    else void loop();

    const onRequest = () => wake.current();
    addEventListener(SCAN_EVENT, onRequest);
    return () => {
      removeEventListener(SCAN_EVENT, onRequest);
      ctl.abort();
      setProgress(null);
    };
  }, [paused]);

  const toggle = () => {
    const next = !paused;
    try {
      localStorage.setItem(PAUSE_KEY, next ? "1" : "0");
    } catch {
      // Storage blocked: the choice lasts until the page reloads.
    }
    setPaused(next);
  };

  if (!progress && !paused && !note) return null;
  return (
    <div role="status" className="hidden md:flex items-center gap-2 shrink-0 text-xs text-subtle">
      {progress ? <Loader2 className="size-3.5 animate-spin" /> : <ScanFace className="size-3.5" />}
      <span className="max-w-80 truncate" title={progress ? `Scanning ${progress.title}` : undefined}>
        {paused
          ? "Face scan paused"
          : progress
            ? `Scanning faces: ${n(progress.left)} photos to go, ${progress.msPerPhoto ? timeLeft(progress.left * progress.msPerPhoto) : "working out the time"}`
            : note}
      </span>
      {(progress || paused) && (
        <button
          type="button"
          onClick={toggle}
          aria-label={paused ? "Resume face scan" : "Pause face scan"}
          title={paused ? "Resume face scan" : "Pause face scan"}
          className="size-7 grid place-items-center rounded-md hover:bg-muted text-foreground"
        >
          {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
