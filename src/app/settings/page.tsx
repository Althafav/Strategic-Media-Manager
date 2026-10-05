import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getRootCovers } from "@/lib/covers";
import { isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { isPending, listUsers } from "@/lib/users";
import { EventSettingsRow } from "./event-settings-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Strategic Media Manager" };

export default async function SettingsPage() {
  if (!(await isAdmin())) notFound();
  const events = isIndexConfigured() ? await listEvents().catch(() => []) : [];
  const users = (await listUsers().catch(() => []))
    .filter((u) => !isPending(u))
    .map((u) => ({ email: u.email, label: u.name || u.email }));
  const covers = await getRootCovers(events.flatMap((e) => e.root_id ?? [])).catch(() => ({}) as Record<string, string>);
  // undefined on every row until migration 0011 runs: no coordinator picker then.
  const hasCoordinators = events.some((e) => e.coordinator_email !== undefined);

  return (
    <div className="max-w-3xl">
      <div className="pt-10 mb-6">
        <h1 className="display text-5xl">Settings</h1>
        <p className="text-subtle mt-1">
          Rename events, choose each one&apos;s cover photo and its marketing coordinator, who receives its photo requests. Renaming doesn&apos;t
          change the event&apos;s link.
        </p>
      </div>

      {!hasCoordinators && events.length > 0 && (
        <p className="mb-4 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          To assign coordinators, run <code>supabase/migrations/0011_photo_requests.sql</code> in the Supabase SQL editor.
        </p>
      )}

      {events.length === 0 ? (
        <p className="py-16 text-center text-subtle">No events yet.</p>
      ) : (
        <section>
          <h2 className="font-medium mb-2">Events</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {events.map((e) => (
              <EventSettingsRow
                key={e.id}
                slug={e.slug}
                title={e.title}
                coordinator={hasCoordinators ? { current: e.coordinator_email ?? null, users } : undefined}
                rootId={e.root_id}
                coverId={e.root_id ? covers[e.root_id] : undefined}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
