import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/share-types";
import { listUsers } from "@/lib/users";
import { AddUserForm, RemoveUserButton } from "./user-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · Strategic Media Manager" };

export default async function UsersPage() {
  if (!(await isAdmin())) notFound();
  const users = await listUsers().catch(() => null);

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
          <AddUserForm />
          {users.length === 0 ? (
            <p className="py-16 text-center text-subtle">No users yet. Add someone&apos;s Microsoft email above.</p>
          ) : (
            <ul className="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
              {users.map((u) => (
                <li key={u.email} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                  <div className="flex-1 min-w-56">
                    <p className="font-medium truncate">{u.name || u.email}</p>
                    {u.name && <p className="text-sm text-subtle truncate">{u.email}</p>}
                  </div>
                  <div className="text-xs text-subtle w-44">
                    <p>Added {formatDate(u.added_at)}</p>
                    <p>{u.last_login_at ? `Last sign-in ${formatDate(u.last_login_at)}` : "Hasn't signed in yet"}</p>
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
