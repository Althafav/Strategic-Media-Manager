import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { canHandle, getRequest, requestMedia } from "@/lib/requests";
import { isOpen, isUnseenAnswer } from "@/lib/request-types";
import { formatDate } from "@/lib/share-types";
import { shareOwner } from "@/lib/shares";
import { listUsers } from "@/lib/users";
import { MarkSeen } from "../mark-seen";
import { DeleteRequestButton, RequestControls } from "../request-controls";
import { handledBy, RequestWhere, StatusChip } from "../request-parts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photo request · Strategic Media Manager" };

/**
 * One request with every picked photo in the regular gallery: grid, lightbox, select + download/zip/share.
 * Visible to the requester, the event's coordinator and the admin; anyone else gets a 404.
 */
export default async function RequestPage({ params }: PageProps<"/requests/[id]">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/requests/${encodeURIComponent(id)}`);
  const found = await getRequest(session, id);
  if (!found) notFound();
  const { request: r, event } = found;

  const [media, users] = await Promise.all([requestMedia([r], [event]), listUsers().catch(() => [])]);
  const items = media.get(r.id) ?? [];
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (owner: string | null | undefined) =>
    owner === "admin" ? "Admin" : owner ? (nameByEmail.get(owner) ?? owner) : "Unknown";
  const coordinator = canHandle(session, event);
  const by = handledBy(r, event);

  return (
    <>
      {/* The requester opening an answer they hadn't seen clears it from the header badge. */}
      {r.requested_by === shareOwner(session) && isUnseenAnswer(r) && <MarkSeen id={r.id} />}
      <div className="pt-6">
        <Link href={coordinator ? "/requests" : "/requests?tab=sent"} className="text-sm text-subtle hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="size-4" /> Requests
        </Link>
      </div>

      <div className="mt-3 max-w-4xl space-y-3">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <h1 className="display text-4xl md:text-5xl flex-1 min-w-0 text-balance">Request from {person(r.requested_by)}</h1>
          <StatusChip status={r.status} />
        </div>
        <RequestWhere request={r} event={event} />
        <p className="text-xs text-subtle">
          Sent {formatDate(r.created_at)}
          {by ? `, ${r.resolved_by ? "answered by" : "to"} ${person(by)}` : ""}
          {r.resolved_at ? ` on ${formatDate(r.resolved_at)}` : ""}
        </p>
        <p className="rounded-lg border border-border bg-surface px-4 py-3 whitespace-pre-wrap break-words">{r.message}</p>
        {coordinator ? (
          <RequestControls
            key={`${r.status}:${r.coordinator_note ?? ""}`}
            id={r.id}
            status={r.status}
            note={r.coordinator_note}
            leaveTo="/requests"
          />
        ) : (
          <div className="flex items-start gap-2">
            {r.coordinator_note && (
              <p className="flex-1 text-sm rounded-md bg-background border border-border px-3 py-2 whitespace-pre-wrap break-words">
                <span className="font-medium">{person(by)}:</span> {r.coordinator_note}
              </p>
            )}
            {!isOpen(r.status) && <DeleteRequestButton id={r.id} leaveTo="/requests?tab=sent" />}
          </div>
        )}
      </div>

      {items.length > 0 ? (
        <Gallery
          path={[]}
          folderName={`Request ${formatDate(r.created_at)} - ${person(r.requested_by)}`}
          items={items}
          downloadAll={items.map(({ event: e, id: itemId }) => ({ event: e, id: itemId }))}
          listedOrder="Requested"
          canShare
          showDetails={session.role === "admin"}
        />
      ) : (
        <p className="mt-10 text-subtle">No photos were picked for this request; it&apos;s a message only.</p>
      )}
    </>
  );
}
