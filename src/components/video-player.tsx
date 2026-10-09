"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Film, Loader2 } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { downloadHref, streamHref, videoStreamHref } from "@/lib/format";

type Mode = "original" | "stream";

/**
 * Lightbox player for regular videos (MP4, MOV…). Plays the original file when this computer can decode it.
 * Otherwise it plays OneDrive's live 1080p stream (DASH, via Shaka Player loaded only then), keeping the
 * position. The camera MP4s are 4K HEVC 4:2:2 10-bit, which only some graphics hardware decodes.
 */
export function VideoPlayer({ item, onEnded }: { item: MediaItem; onEnded?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const resumeAt = useRef(0);

  useEffect(() => {
    let cancelled = false;
    canPlayOriginal(item).then((ok) => !cancelled && setMode(ok ? "original" : "stream"));
    return () => {
      cancelled = true;
    };
  }, [item]);

  const switchToStream = () => {
    resumeAt.current = video.current?.currentTime ?? 0;
    setLoading(true);
    setMode("stream");
  };

  // Original: the browser may load it and play only the sound (no video decoder), so check frames really appear.
  useEffect(() => {
    const el = video.current;
    if (!el || mode !== "original") return;
    const fallback = () => {
      resumeAt.current = el.currentTime;
      setLoading(true);
      setMode("stream");
    };
    const check = () => {
      if (el.currentTime < 1.5) return;
      el.removeEventListener("timeupdate", check);
      if (!el.videoWidth || el.getVideoPlaybackQuality?.().totalVideoFrames === 0) fallback();
    };
    const onMeta = () => {
      if (!el.videoWidth) fallback();
    };
    el.addEventListener("timeupdate", check);
    el.addEventListener("loadedmetadata", onMeta);
    return () => {
      el.removeEventListener("timeupdate", check);
      el.removeEventListener("loadedmetadata", onMeta);
    };
  }, [mode]);

  // Stream: OneDrive transcodes 4K sources slower than real time per segment but in parallel, so prefetch
  // a few segments at once. ABR is off: transcode waits would read as low bandwidth and drop it to 240p.
  useEffect(() => {
    const el = video.current;
    if (!el || mode !== "stream") return;
    let player: { destroy(): Promise<unknown> } | null = null;
    let cancelled = false;
    (async () => {
      const { default: shaka } = await import("shaka-player/dist/shaka-player.dash");
      if (cancelled) return;
      shaka.polyfill.installAll();
      const p = new shaka.Player();
      player = p;
      await p.attach(el);
      p.configure({
        // More than ~4 at once per track and OneDrive answers 429.
        streaming: {
          segmentPrefetchLimit: 4,
          bufferingGoal: 40,
          rebufferingGoal: 3,
          retryParameters: { maxAttempts: 6, baseDelay: 1000, backoffFactor: 2, fuzzFactor: 0.5, timeout: 60_000, stallTimeout: 0, connectionTimeout: 0 },
        },
        abr: { enabled: false, defaultBandwidthEstimate: 8_000_000 },
      });
      p.addEventListener("error", () => setFailed(true));
      await p.load(videoStreamHref(item), resumeAt.current || null);
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      player?.destroy().catch(() => {});
    };
  }, [mode, item]);

  if (failed) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-white/70 text-center">
        <Film className="size-12" strokeWidth={1.5} />
        <p>The video couldn&apos;t be played.</p>
        <a href={downloadHref(item)} className="h-9 px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2">
          <Download className="size-4" /> Download original
        </a>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center px-2 sm:px-16 py-2">
      {mode && (
        <video
          key={mode}
          ref={video}
          src={mode === "original" ? streamHref(item) : undefined}
          poster={item.preview}
          controls
          autoPlay
          onEnded={onEnded}
          onPlaying={() => setLoading(false)}
          onError={mode === "original" ? switchToStream : undefined}
          className="max-h-full max-w-full rounded"
        />
      )}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
        {loading && (
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Loading video…
          </span>
        )}
        {mode === "original" && (
          <button
            onClick={switchToStream}
            title="Play OneDrive's 1080p stream instead: smoother on slow connections"
            className="rounded-full bg-black/60 hover:bg-black/80 px-3 py-1.5 text-xs"
          >
            Stuttering? Play 1080p
          </button>
        )}
        {mode === "stream" && (
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-xs" title="The original file stays untouched; download it for full quality.">
            1080p stream
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Whether to try the original first. OneDrive only says "HEVC", not the profile; the camera files are
 * Main 4:2:2 10, so HEVC goes to the stream unless the browser reports it can decode that. Other codecs
 * (and items from the search index, which has no codec) try the original; playback still falls back.
 */
async function canPlayOriginal(item: MediaItem): Promise<boolean> {
  if (!/^(hevc|hvc1|hev1|h265)$/i.test(item.videoCodec ?? "")) return true;
  try {
    const info = await navigator.mediaCapabilities.decodingInfo({
      type: "file",
      video: {
        contentType: 'video/mp4; codecs="hvc1.4.10.L153.B0"',
        width: item.width || 3840,
        height: item.height || 2160,
        bitrate: 100_000_000,
        framerate: 60,
      },
    });
    return info.supported;
  } catch {
    return false;
  }
}
