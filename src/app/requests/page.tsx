import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listEvents } from "@/lib/events";
import { browseHref, cleanName } from "@/lib/format";
import { isCoordinator, listAssigned, listMine, STATUS_LABEL, type PhotoRequestRow, type RequestStatus } from "@/lib/requests";
import { formatDate } from "@/lib/share-types";
import { listUsers } from "@/lib/users";
import { RequestControls } from "./request-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photo requests · Strategic Media Manager" };

const CHIP: Record<RequestStatus, string> = {
  pending: "bg-amber-500/20",
  in_progress: "bg-sky-500/15",
  fulfilled: "bg-green-600/15",
  declined: "bg-muted",
};

export default async function RequestsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/requests");
  const coordinator = await isCoordinator(session);
  const [assigned, mine, events, users] = await Promise.all([
    coordinator ? listAssigned(session).catch(() => null) : [],
    listMine(session).catch(() => null),
    listEvents({ includeHidden: true }),
    listUsers().catch(() => []),
  ]);
  const eventById = new Map(events.map((e) => [e.id, e]));
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (owner: string | null | undefined) =>
    owner === "admin" ? "Admin" : owner ? (nameByEmail.get(owner) ?? owner) : "Unknown";
  const open = assigned?.filter((r) => r.status === "pending" || r.status === "in_progress") ?? [];
  const answered = assigned?.filter((r) => r.status === "fulfilled" || r.status === "declined") ?? [];

  const where = (r: PhotoRequestRow) => {
    const event = eventById.get(r.event_id);
    const label = [event?.title ?? "Unknown event", ...r.folder_path.map(cleanName)].join(" / ");
    return event ? (
      <Link href={browseHref(event.slug, r.folder_path)} className="text-sm text-subtle hover:text-foreground truncate block">
        {label}
      </Link>
    ) : (
      <p className="text-sm text-subtle truncate">{label}</p>
    );
  };

  const assignedRow = (r: PhotoRequestRow) => (
    <li key={r.id} className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="flex-1 min-w-60">
          {where(r)}
          <p className="whitespace-pre-wrap break-words mt-1">{r.message}</p>
        </div>
        <div className="text-xs text-subtle w-44">
          <p className="truncate" title={r.requested_by}>
            From {person(r.requested_by)}
          </p>
          <p>Sent {formatDate(r.created_at)}</p>
          <StatusChip status={r.status} />
        </div>
      </div>
      <RequestControls id={r.id} status={r.status} note={r.coordinator_note} />
    </li>
  );

  return (
    <div className="max-w-4xl">
      <div className="pt-10 mb-6">
        <h1 className="display text-5xl">Photo requests</h1>
        <p className="text-subtle mt-1">
          Ask an event&apos;s marketing coordinator for photos with <strong>Request photos</strong> on the event page.
        </p>
      </div>

      {mine === null ? (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Photo requests aren&apos;t set up yet. Run <code>supabase/migrations/0011_photo_requests.sql</code> in the
          Supabase SQL editor.
        </p>
      ) : (
        <>
          {coordinator && assigned && (
            <section className="mb-10">
              <h2 className="font-medium mb-2">
                {session.role === "admin" ? "All requests" : "Assigned to me"}{" "}
                <span className="text-subtle font-normal">({open.length} open)</span>
              </h2>
              {open.length === 0 ? (
                <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-subtle">No open requests.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-amber-500/30 bg-surface">{open.map(assignedRow)}</ul>
              )}
              {answered.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-subtle hover:text-foreground">
                    Answered ({answered.length})
                  </summary>
                  <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                    {answered.map(assignedRow)}
                  </ul>
                </details>
              )}
            </section>
          )}

          <section>
            <h2 className="font-medium mb-2">
              My requests <span className="text-subtle font-normal">({mine.length})</span>
            </h2>
            {mine.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-subtle">
                You haven&apos;t requested any photos yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {mine.map((r) => {
                  const event = eventById.get(r.event_id);
                  return (
                    <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3">
                      <div className="flex-1 min-w-60">
                        {where(r)}
                        <p className="whitespace-pre-wrap break-words mt-1">{r.message}</p>
                        {r.coordinator_note && (
                          <p className="mt-2 text-sm rounded-md bg-background border border-border px-3 py-2 whitespace-pre-wrap break-words">
                            <span className="font-medium">{person(r.resolved_by ?? event?.coordinator_email)}:</span>{" "}
                            {r.coordinator_note}
                          </p>
                        )}
                      </div>
                      <div className="text-xs text-subtle w-44">
                        <p>Sent {formatDate(r.created_at)}</p>
                        {event?.coordinator_email && <p className="truncate">To {person(event.coordinator_email)}</p>}
                        <StatusChip status={r.status} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: RequestStatus }) {
  return (
    <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-xs text-foreground ${CHIP[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}
