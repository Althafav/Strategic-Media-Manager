"use client";

import { useState } from "react";

/** [x, y, w, h] as fractions of the photo. */
export type FaceBox = [number, number, number, number];

/**
 * A square crop around one face of a photo, with some room around it. The photo is positioned inside a clipped
 * square, so nothing is re-encoded and the browser reuses the cached thumbnail.
 */
export function FaceCrop({ src, box, alt = "", className = "" }: { src: string; box: FaceBox; alt?: string; className?: string }) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  let style: React.CSSProperties = { opacity: 0 };
  if (size) {
    const [x, y, w, h] = box;
    const side = Math.max(w * size.w, h * size.h) * 1.5;
    const left = (x + w / 2) * size.w - side / 2;
    const top = (y + h / 2) * size.h - side / 2;
    // Percentages are of the square's width, also for `top`: the square's height is the same.
    style = { width: `${(size.w / side) * 100}%`, left: `${(-left / side) * 100}%`, top: `${(-top / side) * 100}%` };
  }
  return (
    <span className={`relative block aspect-square overflow-hidden bg-muted ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        draggable={false}
        onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={style}
        className="absolute max-w-none"
      />
    </span>
  );
}
