import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { BIN_DAYS, daysLeft } from "@/lib/bin";
import { listEvents } from "@/lib/events";
import { cleanName } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/request-types";
import { listBinnedRequests } from "@/lib/requests";
import { formatDate, isExpired, isItemShare } from "@/lib/share-types";
import { listBinnedShares } from "@/lib/shares";
import { listUsers } from "@/lib/users";
import { BinItemControls, EmptyBinButton } from "./bin-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recycle bin · Strategic Media Manager" };

/** Admin-only: revoked share links and deleted photo requests (migration 0018), restorable for BIN_DAYS. */
export default async function BinPage() {
  if (!(await isAdmin())) notFound();
  const [shares, requests, events, users] = await Promise.all([
    listBinnedShares().catch(() => null),
    listBinnedRequests().catch(() => null),
    listEvents({ includeHidden: true }),
    listUsers().catch(() => []),
  ]);
  const eventTitle = new Map(events.map((e) => [e.id, e.title]));
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (owner: string | null | undefined) =>
    owner === "admin" ? "Admin" : owner ? (nameByEmail.get(owner) ?? owner) : "Unknown";
  const total = (shares?.length ?? 0) + (requests?.length ?? 0);

  const deletedLine = (row: { deleted_at?: string | null; deleted_by?: string | null }) => {
    if (!row.deleted_at) return null;
    const left = daysLeft(row.deleted_at);
    return (
      <>
        <p className="truncate">
          Deleted by {person(row.deleted_by)}, {formatDate(row.deleted_at)}
        </p>
        <p>{left === 0 ? "Deleted for good at the next nightly cleanup" : `Deleted for good in ${left} ${left === 1 ? "day" : "days"}`}</p>
      </>
    );
  };

  return (
    <div className="max-w-3xl">
      <div className="pt-10 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-64">
          <h1 className="display text-5xl">Recycle bin</h1>
          <p className="text-subtle mt-1">
            Revoked share links and deleted photo requests are kept here for {BIN_DAYS} days, then deleted for good.
            Only you can see this.
          </p>
        </div>
        {total > 0 && <EmptyBinButton count={total} />}
      </div>

      {shares === null || requests === null ? (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          The recycle bin isn&apos;t set up yet. Run <code>supabase/migrations/0018_recycle_bin.sql</code> in the Supabase
          SQL editor.
        </p>
      ) : (
        <>
          <section className="mb-8">
            <h2 className="font-medium mb-2">
              Share links <span className="text-subtle font-normal">({shares.length})</span>
            </h2>
            {shares.length === 0 ? (
              <p className="py-8 text-center text-sm text-subtle rounded-lg border border-border bg-surface">
                No revoked links.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {shares.map((s) => {
                  const picked = s.item_ids?.length ?? 0;
                  const where = [eventTitle.get(s.event_id) ?? "Unknown event", ...s.folder_path.map(cleanName)].join(" / ");
                  return (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                      <div className="flex-1 min-w-56">
                        <p className="font-medium truncate">{s.label || "Unnamed link"}</p>
                        <p className="text-sm truncate">
                          {isItemShare(s) ? `${s.folder_name} (${picked} picked ${picked === 1 ? "item" : "items"})` : "Whole folder"}
                        </p>
                        <p className="text-sm text-subtle truncate">{where}</p>
                      </div>
                      <div className="text-xs text-subtle w-48">
                        <p className="truncate">Added by {person(s.created_by)}</p>
                        {deletedLine(s)}
                        {isExpired(s) && <p>Expired, stays expired if restored</p>}
                      </div>
                      <BinItemControls kind="share" id={s.id} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-medium mb-2">
              Photo requests <span className="text-subtle font-normal">({requests.length})</span>
            </h2>
            {requests.length === 0 ? (
              <p className="py-8 text-center text-sm text-subtle rounded-lg border border-border bg-surface">
                No deleted requests.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="flex-1 min-w-56">
                      <p className="font-medium truncate">{r.message.split(/\r?\n/)[0]}</p>
                      <p className="text-sm truncate">
                        {person(r.requested_by)}, {STATUS_LABEL[r.status]}
                      </p>
                      <p className="text-sm text-subtle truncate">{eventTitle.get(r.event_id) ?? "Unknown event"}</p>
                    </div>
                    <div className="text-xs text-subtle w-48">
                      <p>Requested {formatDate(r.created_at)}</p>
                      {deletedLine(r)}
                    </div>
                    <BinItemControls kind="request" id={r.id} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
