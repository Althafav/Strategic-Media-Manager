import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { listEvents } from "@/lib/events";
import type { MediaItem } from "@/lib/onedrive/types";
import { isOpen, isUnseenAnswer } from "@/lib/request-types";
import {
  inboxSeenAt,
  isCoordinator,
  listAssigned,
  listMine,
  pendingCountFor,
  requestMedia,
  unseenAnswersFor,
  type PhotoRequestRow,
} from "@/lib/requests";
import { formatDate } from "@/lib/share-types";
import { listUsers } from "@/lib/users";
import { MarkSeen } from "./mark-seen";
import { DeleteRequestButton, RequestControls } from "./request-controls";
import { handledBy, RequestWhere, StatusChip } from "./request-parts";
import { RequestedItems } from "./requested-items";

export const dynamic = "force-dynamic";
export const metadata = { title: "Photo requests · Strategic Media Manager" };

const MIGRATION_0011 = (
  <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
    Photo requests aren&apos;t set up yet. Run <code>supabase/migrations/0011_photo_requests.sql</code> in the Supabase SQL
    editor.
  </p>
);

export default async function RequestsPage({ searchParams }: PageProps<"/requests">) {
  const session = await getSession();
  if (!session) redirect("/login?next=/requests");
  const coordinator = await isCoordinator(session);
  // Coordinators (and the admin) land on what they need to handle; everyone else only has Sent.
  const tab = coordinator && (await searchParams).tab !== "sent" ? "inbox" : "sent";

  const [inbox, sent, events, users, newCount, replyCount] = await Promise.all([
    tab === "inbox" ? listAssigned(session).catch(() => null) : null,
    tab === "sent" ? listMine(session).catch(() => null) : null,
    listEvents({ includeHidden: true }),
    listUsers().catch(() => []),
    coordinator ? pendingCountFor(session).catch(() => 0) : 0,
    unseenAnswersFor(session).catch(() => 0),
  ]);
  const rows = inbox ? [...inbox.open, ...inbox.answered] : (sent ?? []);
  const media = await requestMedia(rows, events).catch(() => new Map<string, MediaItem[]>());
  const eventById = new Map(events.map((e) => [e.id, e]));
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (owner: string | null | undefined) =>
    owner === "admin" ? "Admin" : owner ? (nameByEmail.get(owner) ?? owner) : "Unknown";

  // Viewing a tab clears its new items from the header badge. Sent highlights its new replies this once (below).
  const seenAt = tab === "inbox" ? await inboxSeenAt() : undefined;
  const newestShown = inbox?.open
    .filter((r) => r.status === "pending" && (!seenAt || Date.parse(r.created_at) > Date.parse(seenAt)))
    .reduce<string | undefined>((max, r) => (!max || Date.parse(r.created_at) > Date.parse(max) ? r.created_at : max), undefined);
  const markSeen = newestShown ? (
    <MarkSeen inboxUpTo={newestShown} />
  ) : tab === "sent" && sent?.some(isUnseenAnswer) ? (
    <MarkSeen sent />
  ) : null;

  const body = (r: PhotoRequestRow) => {
    const event = eventById.get(r.event_id);
    const items = media.get(r.id);
    const href = `/requests/${r.id}`;
    return (
      <>
        <RequestWhere request={r} event={event} />
        <Link href={href} className="block mt-1 whitespace-pre-wrap break-words hover:underline underline-offset-4">
          {r.message}
        </Link>
        {items?.length ? <RequestedItems href={href} items={items} /> : null}
      </>
    );
  };

  const inboxRow = (r: PhotoRequestRow) => (
    <li key={r.id} className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1">
        <div className="flex-1 min-w-60">{body(r)}</div>
        <div className="text-xs text-subtle w-44 space-y-0.5">
          <p className="truncate" title={r.requested_by}>
            From {person(r.requested_by)}
          </p>
          <p>Sent {formatDate(r.created_at)}</p>
          <StatusChip status={r.status} />
        </div>
      </div>
      {/* key: start from the saved note again after each answer */}
      <RequestControls key={`${r.status}:${r.coordinator_note ?? ""}`} id={r.id} status={r.status} note={r.coordinator_note} />
    </li>
  );

  const sentRow = (r: PhotoRequestRow) => {
    const unseen = isUnseenAnswer(r);
    const by = handledBy(r, eventById.get(r.event_id));
    return (
      <li key={r.id} className={`flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-3 ${unseen ? "bg-amber-500/5" : ""}`}>
        <div className="flex-1 min-w-60">
          {body(r)}
          {r.coordinator_note && (
            <p className="mt-2 text-sm rounded-md bg-background border border-border px-3 py-2 whitespace-pre-wrap break-words">
              <span className="font-medium">{person(by)}:</span> {r.coordinator_note}
            </p>
          )}
        </div>
        <div className="text-xs text-subtle w-44 space-y-0.5">
          <p>Sent {formatDate(r.created_at)}</p>
          {by && (
            <p className="truncate">
              {r.resolved_by ? "Answered by" : "To"} {person(by)}
            </p>
          )}
          <p className="flex items-center gap-1.5">
            <StatusChip status={r.status} />
            {unseen && <span className="font-medium text-foreground">New reply</span>}
          </p>
        </div>
        {!isOpen(r.status) && <DeleteRequestButton id={r.id} compact />}
      </li>
    );
  };

  const tabLink = (id: "inbox" | "sent", label: string, count: number) => (
    <Link
      href={`/requests?tab=${id}`}
      aria-current={tab === id ? "page" : undefined}
      className={`h-8 px-3 rounded-[5px] text-sm inline-flex items-center gap-2 ${
        tab === id ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground"
      }`}
    >
      {label}
      {count > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500/25 text-xs text-foreground grid place-items-center">{count}</span>
      )}
    </Link>
  );

  const empty = (text: string) => <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-subtle">{text}</p>;

  return (
    <div className="max-w-4xl">
      {markSeen}
      <div className="pt-10 mb-6">
        <h1 className="display text-5xl">Photo requests</h1>
        <p className="text-subtle mt-1">
          Ask an event&apos;s marketing coordinator for photos: use <strong>Request photos</strong> on the event page, or
          select photos and click <strong>Request</strong>.
        </p>
        {coordinator && (
          <nav aria-label="Requests" className="mt-4 inline-flex rounded-md border border-border bg-surface p-0.5">
            {tabLink("inbox", session.role === "admin" ? "Inbox (all events)" : "Inbox", newCount)}
            {tabLink("sent", "Sent", replyCount)}
          </nav>
        )}
      </div>

      {tab === "inbox" ? (
        inbox === null ? (
          MIGRATION_0011
        ) : (
          <>
            <h2 className="font-medium mb-2">
              Open <span className="text-subtle font-normal">({inbox.open.length}, oldest first)</span>
            </h2>
            {inbox.open.length === 0 ? (
              empty("Nothing waiting. New requests show up here.")
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-amber-500/30 bg-surface">{inbox.open.map(inboxRow)}</ul>
            )}
            {inbox.answered.length > 0 && (
              <details className="mt-6">
                <summary className="cursor-pointer text-sm text-subtle hover:text-foreground">
                  Answered ({inbox.answered.length}
                  {inbox.answered.length === 100 ? ", latest 100" : ""})
                </summary>
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface">
                  {inbox.answered.map(inboxRow)}
                </ul>
              </details>
            )}
          </>
        )
      ) : sent === null ? (
        MIGRATION_0011
      ) : sent.length === 0 ? (
        empty("You haven't requested any photos yet.")
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{sent.map(sentRow)}</ul>
      )}
    </div>
  );
}
