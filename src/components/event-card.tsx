"use client";

import Link from "next/link";
import { useState } from "react";
import { Images } from "lucide-react";
import { RemoveEventButton } from "@/components/remove-event-button";
import { browseHref, coverSrc, formatBytes } from "@/lib/format";

type Props = { slug: string; title: string; rootId: string | null; itemCount: number | null; size: number | null };

/** One event as a wide sheet: the cover photo leads, the title sits beside it in condensed type. */
export function EventCard({ slug, title, rootId, itemCount, size }: Props) {
  const [hasCover, setHasCover] = useState(!!rootId);
  const count = itemCount ?? 0;
  return (
    <div className="group relative">
      <Link
        href={browseHref(slug)}
        className="grid md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] bg-surface border border-border hover:border-foreground transition-colors"
      >
        <div className="aspect-[16/9] bg-muted grid place-items-center overflow-hidden">
          {hasCover ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={coverSrc({ event: slug, id: rootId! })}
              alt=""
              loading="lazy"
              onError={() => setHasCover(false)}
              className="size-full object-cover"
            />
          ) : (
            <Images className="size-10 text-subtle" />
          )}
        </div>
        <div className="flex flex-col justify-end gap-2 p-5 md:p-8">
          <h2 className="display text-4xl md:text-5xl text-balance">{title}</h2>
          <p className="text-sm text-subtle">
            {count} {count === 1 ? "folder" : "folders"}
            {size ? `, ${formatBytes(size)}` : ""}
          </p>
        </div>
      </Link>
      {/* Sibling of the link (not inside it) so clicking it never opens the event. Revealed on hover where hover exists. */}
      <RemoveEventButton
        slug={slug}
        title={title}
        className="absolute top-3 right-3 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}
