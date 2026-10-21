import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { timeAgo } from "@/lib/format";
import { formatDate } from "@/lib/share-types";
import { isPending, listUsers, SEEN_EVERY_MS, type UserRow } from "@/lib/users";
import { AddUserForm, ApproveUserButton, RemoveUserButton } from "./user-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · Strategic Media Manager" };

export default async function UsersPage() {
  if (!(await isAdmin())) notFound();
  const users = await listUsers().catch(() => null);
  const requests = (users ?? []).filter(isPending).sort((a, b) => (b.requested_at ?? "").localeCompare(a.requested_at ?? ""));
  // Most recently online first; before 0022 or never seen, the last sign-in counts. Never signed in goes last.
  const lastOnline = (u: UserRow) => u.last_seen_at ?? u.last_login_at ?? "";
  const active = (users ?? []).filter((u) => !isPending(u)).sort((a, b) => lastOnline(b).localeCompare(lastOnline(a)));

  return (
    <div className="max-w-3xl">
      <div className="pt-10 mb-6">
        <h1 className="display text-5xl">Users</h1>
        <p className="text-subtle mt-1">
          Team members who can sign in with Microsoft. Removing someone signs them out within a minute.
        </p>
      </div>

      {users === null ? (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Users aren&apos;t set up yet. Run <code>supabase/migrations/0007_app_users.sql</code> in the Supabase SQL editor.
        </p>
      ) : (
        <>
          {requests.length > 0 && (
            <section className="mb-6">
              <h2 className="font-medium mb-2">
                Access requests <span className="text-subtle font-normal">({requests.length})</span>
              </h2>
              <ul className="divide-y divide-border rounded-lg border border-amber-500/30 bg-surface">
                {requests.map((u) => (
                  <li key={u.email} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="flex-1 min-w-56">
                      <p className="font-medium truncate">{u.email}</p>
                      <p className="text-xs text-subtle">
                        Waiting for approval{u.requested_at ? `, requested ${formatDate(u.requested_at)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ApproveUserButton email={u.email} />
                      <RemoveUserButton email={u.email} reject />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <AddUserForm />
          {active.length === 0 ? (
            <p className="py-16 text-center text-subtle">No users yet. Add someone&apos;s Microsoft email above.</p>
          ) : (
            <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
              {active.map((u) => (
                <li key={u.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="flex-1 min-w-56">
                    <p className="font-medium truncate">{u.name || u.email}</p>
                    {u.name && <p className="text-sm text-subtle truncate">{u.email}</p>}
                  </div>
                  <div className="text-xs text-subtle w-44">
                    <p>Added {formatDate(u.added_at)}</p>
                    <p>{u.last_login_at ? `Last sign-in ${formatDate(u.last_login_at)}` : "Hasn't signed in yet"}</p>
                    {u.last_seen_at && <LastSeen seen={lastSeen(u.last_seen_at)} />}
                  </div>
                  <RemoveUserButton email={u.email} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60_000;

/** Last activity recorded by proxy.ts (migration 0022): online, or "3 h ago", or a date after a week. */
function lastSeen(iso: string): { online: true } | { online: false; when: string } {
  const now = Date.now();
  const ago = now - Date.parse(iso);
  if (ago < SEEN_EVERY_MS) return { online: true };
  return { online: false, when: ago < WEEK_MS ? timeAgo(iso, now) : formatDate(iso) };
}

function LastSeen({ seen }: { seen: ReturnType<typeof lastSeen> }) {
  if (seen.online) {
    return (
      <p className="flex items-center gap-1.5 text-foreground">
        <span className="size-1.5 rounded-full bg-emerald-600" aria-hidden />
        Online now
      </p>
    );
  }
  return <p>Last seen {seen.when}</p>;
}
