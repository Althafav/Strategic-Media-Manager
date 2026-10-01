import Link from "next/link";
import type { EventRow } from "@/lib/events";
import { browseHref, cleanName } from "@/lib/format";
import { folderCount, isOpen, STATUS_LABEL, type PhotoRequestRow, type RequestStatus } from "@/lib/request-types";

/** Server-rendered bits shared by the /requests list and a request's own page. */

const CHIP: Record<RequestStatus, string> = {
  pending: "bg-amber-500/20",
  in_progress: "bg-sky-500/15",
  fulfilled: "bg-green-600/15",
  declined: "bg-muted",
};

export function StatusChip({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs text-foreground ${CHIP[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

/** "AIM 2026 / Day 1", linked to that folder, plus "4 items from 3 folders" for picked items. */
export function RequestWhere({ request: r, event }: { request: PhotoRequestRow; event: EventRow | undefined }) {
  const label = [event?.title ?? "Unknown event", ...r.folder_path.map(cleanName)].join(" / ");
  const count = r.items?.length ?? 0;
  const folders = count ? folderCount(r.items!, r.folder_path) : 0;
  return (
    <p className="text-sm text-subtle truncate">
      {event ? (
        <Link href={browseHref(event.slug, r.folder_path)} className="hover:text-foreground">
          {label}
        </Link>
      ) : (
        label
      )}
      {count > 0 && (
        <span>
          {" "}
          ({count} {count === 1 ? "item" : "items"}
          {folders > 1 ? ` from ${folders} folders` : ""})
        </span>
      )}
    </p>
  );
}

/** Who the request is with: the coordinator while it's open, whoever answered once it's closed. */
export function handledBy(r: PhotoRequestRow, event: EventRow | undefined): string | null | undefined {
  return isOpen(r.status) ? event?.coordinator_email : (r.resolved_by ?? event?.coordinator_email);
}
