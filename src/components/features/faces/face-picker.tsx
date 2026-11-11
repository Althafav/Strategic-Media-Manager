"use client";

/** One face found in the visitor's photo: a small crop drawn on the device, and its place in the list of faces. */
export type PickableFace = { index: number; thumb: string };

/** A small square crop of one face, drawn locally (nothing is uploaded). `box` is [x, y, w, h] as fractions. */
export function faceThumb(bitmap: ImageBitmap, box: [number, number, number, number]): string {
  const [x, y, w, h] = box;
  const side = Math.max(w * bitmap.width, h * bitmap.height) * 1.5;
  const cx = (x + w / 2) * bitmap.width;
  const cy = (y + h / 2) * bitmap.height;
  const canvas = Object.assign(document.createElement("canvas"), { width: 200, height: 200 });
  canvas.getContext("2d")!.drawImage(bitmap, cx - side / 2, cy - side / 2, side, side, 0, 0, 200, 200);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Shown when the photo has several faces: the visitor says who to look for, instead of us guessing. */
export function FacePicker({ faces, onPick }: { faces: PickableFace[]; onPick: (index: number) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">There are {faces.length} people in this photo. Who are you looking for?</p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
        {faces.map((f, n) => (
          <li key={f.index}>
            <button
              type="button"
              onClick={() => onPick(f.index)}
              aria-label={`Person ${n + 1}`}
              className="block w-full border border-border hover:border-foreground"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.thumb} alt="" className="aspect-square w-full object-cover" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
