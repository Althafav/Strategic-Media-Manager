"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { itemFacesAction } from "@/app/faces/actions";
import type { PhotoFace } from "@/lib/face-types";
import type { MediaItem } from "@/lib/onedrive/types";
import { FaceCrop } from "./face-crop";

/**
 * The lightbox's "People" strip (team pages): the faces the scan found in the open photo. Choosing one opens
 * every photo of that person. Faces come from the stored index, so no model runs here.
 */
export function PeopleInPhoto({ item }: { item: MediaItem }) {
  const [faces, setFaces] = useState<PhotoFace[] | null>(null);

  useEffect(() => {
    let stale = false;
    itemFacesAction(item.event, item.id)
      .then((res) => !stale && setFaces(res.faces ?? []))
      .catch(() => !stale && setFaces([]));
    return () => {
      stale = true;
    };
  }, [item.event, item.id]);

  const src = item.preview ?? item.thumb;
  return (
    <div className="shrink-0 border-t border-white/10 px-3 py-2 min-h-20 flex items-center gap-2 overflow-x-auto">
      {faces === null ? (
        <p className="text-xs text-white/60 inline-flex items-center gap-2">
          <Loader2 className="size-3.5 animate-spin" /> Looking up faces…
        </p>
      ) : !faces.length || !src ? (
        <p className="text-xs text-white/60">No one recognised in this photo yet. Small or turned-away faces aren&apos;t grouped.</p>
      ) : (
        <>
          <p className="text-xs text-white/60 shrink-0 pr-1">See more photos of</p>
          {faces.map((f) => (
            <Link
              key={f.personId}
              href={`/people/${encodeURIComponent(item.event)}/${f.personId}`}
              title={f.name ? `${f.name}, ${f.photos} photos` : `${f.photos} photos`}
              className="block w-16 shrink-0 outline-offset-2 hover:outline hover:outline-2 hover:outline-white"
            >
              <FaceCrop src={src} box={f.box} alt={f.name ?? "A person in this photo"} />
            </Link>
          ))}
        </>
      )}
    </div>
  );
}
