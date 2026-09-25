import Link from "next/link";
import { Plus } from "lucide-react";
import { EventCard } from "@/components/event-card";
import { isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { getSyncStatuses, type SyncStatus } from "@/lib/sync/status";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!isIndexConfigured()) {
    return (
      <div className="py-24 text-center">
        <h1 className="display text-3xl">Database not configured</h1>
        <p className="text-subtle mt-2">Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to manage events.</p>
      </div>
    );
  }
  const events = await listEvents();
  // Status is extra: the page still renders if it can't be read.
  const sync = await getSyncStatuses(events).catch(() => new Map<string, SyncStatus>());

  return (
    <>
      <div className="pt-10 pb-6 flex flex-wrap items-end gap-4">
        <h1 className="display text-5xl flex-1">Events</h1>
        <Link
          href="/events/new"
          className="h-9 px-3 rounded-md border border-foreground text-sm font-medium inline-flex items-center gap-2 hover:bg-surface"
        >
          <Plus className="size-4" /> Add event
        </Link>
      </div>

      {events.length ? (
        <section className="grid gap-4">
          {events.map((e) => (
            <EventCard key={e.id} slug={e.slug} title={e.title} rootId={e.root_id} itemCount={e.item_count} size={e.size} sync={sync.get(e.id)} />
          ))}
        </section>
      ) : (
        <div className="py-24 text-center">
          <p className="display text-3xl">No events yet</p>
          <p className="text-subtle mt-2">
            Add an event by pasting the OneDrive link to its photo folder.{" "}
            <Link href="/events/new" className="text-foreground underline underline-offset-4">
              Add event
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
