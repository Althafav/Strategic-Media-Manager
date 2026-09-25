"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleAlert, CircleDashed, Clock, Images, Loader2 } from "lucide-react";
import { RemoveEventButton } from "@/components/remove-event-button";
import { SyncEventButton } from "@/components/sync-event-button";
import { browseHref, coverSrc, formatBytes } from "@/lib/format";
import type { SyncStatus } from "@/lib/sync/status";

type Props = {
  slug: string;
  title: string;
  rootId: string | null;
  itemCount: number | null;
  size: number | null;
  /** Search index status; missing when it couldn't be read. */
  sync?: SyncStatus;
};

const REVEAL = "[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-within:opacity-100";

/** One event as a wide sheet: the cover photo leads, the title sits beside it in condensed type. */
export function EventCard({ slug, title, rootId, itemCount, size, sync }: Props) {
  const [hasCover, setHasCover] = useState(!!rootId);
  const count = itemCount ?? 0;
  const needsAttention = sync?.state === "error" || sync?.state === "stale";
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
          {sync && <SyncLine status={sync} />}
        </div>
      </Link>
      {/* Siblings of the link (not inside it) so clicking them never opens the event. Revealed on hover where hover exists,
          except "Sync now", which stays visible when the index needs attention. */}
      <div className="absolute top-3 right-3 flex items-start gap-2">
        <SyncEventButton slug={slug} title={title} revealClass={needsAttention ? "" : REVEAL} />
        <RemoveEventButton slug={slug} title={title} className={REVEAL} />
      </div>
    </div>
  );
}

function SyncLine({ status }: { status: SyncStatus }) {
  const Icon = { running: Loader2, pending: CircleDashed, indexing: CircleDashed, error: CircleAlert, stale: Clock, ok: null }[
    status.state
  ];
  return (
    <p
      title={status.detail}
      className={`text-xs flex items-start gap-1.5 ${status.state === "error" ? "text-red-600" : "text-subtle"}`}
    >
      {Icon && <Icon className={`size-3.5 mt-px shrink-0 ${status.state === "running" ? "animate-spin" : ""}`} aria-hidden />}
      <span>{status.label}</span>
    </p>
  );
}
