import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { getRootCovers } from "@/lib/covers";
import { isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { getFaceIndexStatus, scansFaces } from "@/lib/face-index";
import { isPending, listUsers } from "@/lib/users";
import { EventOrderList } from "./event-order-list";
import { EventSettingsRow } from "./event-settings-row";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings · Strategic Media Manager" };

export default async function SettingsPage() {
  if (!(await isAdmin())) notFound();
  const events = isIndexConfigured() ? await listEvents({ includeHidden: true }).catch(() => []) : [];
  const users = (await listUsers().catch(() => []))
    .filter((u) => !isPending(u))
    .map((u) => ({ email: u.email, label: u.name || u.email }));
  const covers = await getRootCovers(events.flatMap((e) => e.root_id ?? [])).catch(() => ({}) as Record<string, string>);
  // undefined on every row until migration 0011 runs: no coordinator picker then.
  const hasCoordinators = events.some((e) => e.coordinator_email !== undefined);
  // Same for private events until migration 0019 runs.
  const hasPrivacy = events.some((e) => e.viewer_emails !== undefined);
  // And for face search until migration 0023 runs.
  const hasFaces = events.some((e) => e.face_search !== undefined);
  // Before 0025 there is no separate scan switch: only events with guest search on are scanned.
  const hasFaceScan = events.some((e) => e.face_scan !== undefined);
  const faceStatus = hasFaces
    ? Object.fromEntries(await Promise.all(events.map(async (e) => [e.id, await getFaceIndexStatus(e.id).catch(() => null)] as const)))
    : {};

  return (
    <div className="max-w-3xl">
      <div className="pt-10 mb-6">
        <h1 className="display text-5xl">Settings</h1>
        <p className="text-subtle mt-1">
          Reorder events, rename them, choose each one&apos;s cover photo and its marketing coordinator, who receives its photo requests.
          Make an event private to show it only to you and the people you pick.
          Renaming doesn&apos;t change the event&apos;s link. Turn on Face search to scan an event&apos;s photos for faces, so people can
          find the photos they&apos;re in with a selfie.
        </p>
      </div>

      {!hasCoordinators && events.length > 0 && (
        <p className="mb-4 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          To assign coordinators, run <code>supabase/migrations/0011_photo_requests.sql</code> in the Supabase SQL editor.
        </p>
      )}
      {!hasPrivacy && events.length > 0 && (
        <p className="mb-4 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          To make events private, run <code>supabase/migrations/0019_private_events.sql</code> in the Supabase SQL editor.
        </p>
      )}

      {!hasFaces && events.length > 0 && (
        <p className="mb-4 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          To let guests find their photos with a selfie, run <code>supabase/migrations/0023_face_index.sql</code> in the Supabase SQL editor.
        </p>
      )}
      {hasFaces && !hasFaceScan && events.length > 0 && (
        <p className="mb-4 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          To choose which events are scanned for faces, run <code>supabase/migrations/0025_face_scan.sql</code> in the Supabase SQL
          editor. Until then only events with Find my photos on share links are scanned.
        </p>
      )}

      {events.length === 0 ? (
        <p className="py-16 text-center text-subtle">No events yet.</p>
      ) : (
        <>
          {events.length > 1 && (
            <section className="mb-8">
              <h2 className="font-medium mb-2">Event order</h2>
              <EventOrderList
                key={events.map((e) => `${e.slug}:${e.title}`).join("\n")}
                events={events.map(({ slug, title }) => ({ slug, title }))}
              />
            </section>
          )}
          <section>
            <h2 className="font-medium mb-2">Events</h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {events.map((e) => (
                <EventSettingsRow
                  key={e.id}
                  slug={e.slug}
                  title={e.title}
                  shareUrl={e.share_url}
                  coordinator={hasCoordinators ? { current: e.coordinator_email ?? null, users } : undefined}
                  privacy={hasPrivacy ? { hidden: e.hidden, viewers: e.viewer_emails ?? [], users } : undefined}
                  rootId={e.root_id}
                  coverId={e.root_id ? covers[e.root_id] : undefined}
                  faces={hasFaces ? { scan: scansFaces(e), on: !!e.face_search, canSwitchScan: hasFaceScan, status: faceStatus[e.id] ?? null } : undefined}
                />
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
