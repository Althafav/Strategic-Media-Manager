import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FaceCrop } from "@/components/features/faces/face-crop";
import { getSession } from "@/lib/auth";
import { getVisibleEvent } from "@/lib/events";
import { listPeople, scansFaces } from "@/lib/face-index";
import { browseHref, thumbSrc } from "@/lib/format";

export const dynamic = "force-dynamic";

const decode = (seg: string) => {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
};

export async function generateMetadata({ params }: PageProps<"/people/[slug]">) {
  const event = await getVisibleEvent(decode((await params).slug));
  return { title: `People in ${event?.title ?? "event"} · Strategic Media Manager` };
}

/** Everyone the face scan found in an event, most-photographed first. Team members only (no share links). */
export default async function PeoplePage({ params, searchParams }: PageProps<"/people/[slug]">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const event = await getVisibleEvent(decode((await params).slug));
  if (!event || !scansFaces(event)) notFound();
  const everyone = (await searchParams).all === "1";
  const admin = session.role === "admin";
  // Null before migration 0024.
  const all = await listPeople(event.id, everyone ? 1 : 2).catch(() => null);
  const people = all?.filter((p) => admin || !p.hidden) ?? [];
  const base = `/people/${encodeURIComponent(event.slug)}`;

  return (
    <>
      <div className="pt-6">
        <Link href={browseHref(event.slug)} className="text-sm text-subtle hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="size-4" /> {event.title}
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex-1 min-w-0">
          <h1 className="display text-4xl md:text-5xl">People</h1>
          <p className="text-sm text-subtle mt-1">
            {people.length
              ? `${people.length.toLocaleString("en-GB")} ${people.length === 1 ? "person" : "people"}${everyone ? "" : " in two or more photos"}. Choose a face to see their photos.`
              : "Grouped automatically from the faces in this event's photos."}
          </p>
        </div>
        <Link
          href={everyone ? base : `${base}?all=1`}
          className="h-9 px-3 rounded-md border border-border bg-surface text-sm font-medium inline-flex items-center hover:border-foreground"
        >
          {everyone ? "Only people in 2+ photos" : "Show everyone"}
        </Link>
      </div>

      {people.length > 0 ? (
        <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-0.5">
          {people.map((p) => (
            <li key={p.id} className={p.hidden ? "opacity-50" : undefined}>
              <Link href={`${base}/${p.id}`} className="block bg-surface hover:bg-muted">
                <FaceCrop src={thumbSrc({ event: event.slug, id: p.cover.itemId }, 800)} box={p.cover.box} />
                <span className="block px-2 py-1.5 text-xs leading-tight">
                  {p.name && <span className="block truncate text-sm font-medium">{p.name}</span>}
                  <span className="text-subtle">
                    {p.photos} {p.photos === 1 ? "photo" : "photos"}
                    {p.hidden && ", hidden"}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="py-24 text-center">
          <p className="display text-3xl">{all === null ? "People isn't set up yet" : "No people yet"}</p>
          <p className="text-subtle mt-2 max-w-md mx-auto">
            {all === null
              ? "Run supabase/migrations/0024_face_people.sql in the Supabase SQL editor."
              : "People appear here as the event's photos are scanned. Scanning runs by itself while the admin has the app open."}
          </p>
        </div>
      )}
    </>
  );
}
