"use client";

import { useState } from "react";
import Link from "next/link";
import { Folder, Images, Play } from "lucide-react";
import { cleanName, coverSrc } from "@/lib/format";
import type { MediaItem } from "@/lib/onedrive/types";

const SHOWN = 6;

/** A few of the request's picked items; every tile and "View all" open the request's own page with the full gallery. */
export function RequestedItems({ href, items }: { href: string; items: MediaItem[] }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-[2px]">
      {items.slice(0, SHOWN).map((item) => (
        <Tile key={item.id} href={href} item={item} />
      ))}
      <Link
        href={href}
        className="ml-2 h-8 px-3 rounded-md border border-border bg-surface text-sm font-medium inline-flex items-center gap-1.5 hover:border-foreground"
      >
        <Images className="size-3.5" />
        {items.length === 1 ? "View" : `View all ${items.length}`}
      </Link>
    </div>
  );
}

function Tile({ href, item }: { href: string; item: MediaItem }) {
  const [broken, setBroken] = useState(false);
  const src = item.kind === "folder" ? coverSrc(item) : item.thumb;
  const name = item.kind === "folder" ? cleanName(item.name) : item.name;
  return (
    <Link href={href} title={name} className="relative size-16 bg-muted overflow-hidden grid place-items-center hover:opacity-85">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Folder className="size-5 text-subtle" />
      )}
      {item.kind === "folder" && (
        <span className="absolute inset-x-0 bottom-0 bg-black/55 text-white text-[10px] px-1 truncate flex items-center gap-0.5">
          <Folder className="size-2.5 shrink-0" /> {name}
        </span>
      )}
      {item.isVideo && <Play className="absolute inset-0 m-auto size-5 text-white drop-shadow" fill="currentColor" aria-hidden />}
    </Link>
  );
}
