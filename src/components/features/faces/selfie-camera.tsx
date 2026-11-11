"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** How often a camera frame is checked for a face. */
const CHECK_MS = 350;
/** Good frames in a row before the photo is taken by itself (about one second). */
const STEADY = 3;

type Hint = "starting" | "none" | "closer" | "centre" | "steady";

const HINT: Record<Hint, string> = {
  starting: "Getting ready…",
  none: "Put your face inside the outline",
  closer: "Move a little closer",
  centre: "Centre your face",
  steady: "Hold still",
};

/** Where the largest face sits in the frame, as a hint for the guest. */
function judge(boxes: { box: [number, number, number, number] }[]): Hint {
  if (!boxes.length) return "none";
  const [x, y, w, h] = boxes.reduce((a, b) => (b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a)).box;
  if (w < 0.22) return "closer";
  const cx = x + w / 2;
  const cy = y + h / 2;
  if (cx < 0.3 || cx > 0.7 || cy < 0.22 || cy > 0.78) return "centre";
  return "steady";
}

/**
 * The live selfie camera: front camera with an outline to aim at. Frames are checked on the device a few times
 * a second, and the photo is taken by itself once a face is close, centred and still. "Take photo" always works
 * too. `onCapture` gets the frame (the caller closes it); `onBlocked` fires when the camera can't be used.
 */
export function SelfieCamera({ onCapture, onBlocked }: { onCapture: (frame: ImageBitmap) => void; onBlocked: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [hint, setHint] = useState<Hint>("starting");
  const [live, setLive] = useState(false);
  // The checking loop outlives renders; these keep it pointed at the latest callbacks.
  const capture = useRef(onCapture);
  const blocked = useRef(onBlocked);
  useEffect(() => {
    capture.current = onCapture;
    blocked.current = onBlocked;
  });
  const take = useRef<() => void>(() => {});

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let good = 0;

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };

    const shoot = async () => {
      const el = video.current;
      if (stopped || !el?.videoWidth) return;
      const frame = await createImageBitmap(el);
      stop();
      capture.current(frame);
    };
    take.current = shoot;

    const check = async () => {
      const el = video.current;
      if (stopped) return;
      if (el?.videoWidth) {
        try {
          const { detectBoxes } = await import("@/lib/faces");
          const next = judge(await detectBoxes(await createImageBitmap(el)));
          if (stopped) return;
          setHint(next);
          good = next === "steady" ? good + 1 : 0;
          if (good >= STEADY) return shoot();
        } catch {
          // The model couldn't load or run: the manual button still works.
          setHint("none");
        }
      }
      timer = setTimeout(check, CHECK_MS);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch {
        if (!stopped) blocked.current();
        return;
      }
      if (stopped || !video.current) return stop();
      video.current.srcObject = stream;
      await video.current.play().catch(() => {});
      setLive(true);
      check();
    })();

    return stop;
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[3/4] max-h-[52dvh] overflow-hidden rounded-lg bg-foreground">
        {/* Mirrored, like a phone's selfie preview. */}
        <video ref={video} playsInline muted className="size-full object-cover -scale-x-100" />
        {/* The outline to aim at; everything outside it is dimmed. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div
            className={`w-3/5 aspect-[3/4] rounded-[50%] border-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] transition-colors ${
              hint === "steady" ? "border-white" : "border-white/50"
            }`}
          />
        </div>
        <p role="status" aria-live="polite" className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-white">
          {hint === "starting" && <Loader2 className="mr-2 inline size-4 animate-spin" />}
          {HINT[hint]}
        </p>
      </div>
      <Button variant="primary" size="lg" className="w-full" disabled={!live} onClick={() => take.current()}>
        <Camera className="size-5" /> Take photo
      </Button>
    </div>
  );
}
