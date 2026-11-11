import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FaceCrop } from "@/components/features/faces/face-crop";
import { PersonControls } from "@/components/features/faces/person-controls";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { getVisibleEvent } from "@/lib/events";
import { getPerson, personPhotos, scansFaces } from "@/lib/face-index";
import { thumbSrc } from "@/lib/format";
import { nodeToItem } from "@/lib/nodes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Person · Strategic Media Manager" };

const decode = (seg: string) => {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
};

/** One person's photos in an event. Team members only; a hidden person is shown to the admin alone. */
export default async function PersonPage({ params }: PageProps<"/people/[slug]/[id]">) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { slug, id } = await params;
  const event = await getVisibleEvent(decode(slug));
  if (!event || !scansFaces(event)) notFound();
  const admin = session.role === "admin";
  const person = await getPerson(event.id, id).catch(() => null);
  if (!person || (person.hidden && !admin)) notFound();
  const items = (await personPhotos(event.id, person.id)).map((r) => nodeToItem(r, event.slug));
  const title = person.name || "Unnamed person";

  return (
    <>
      <div className="pt-6">
        <Link
          href={`/people/${encodeURIComponent(event.slug)}`}
          className="text-sm text-subtle hover:text-foreground inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="size-4" /> People in {event.title}
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        {person.cover && (
          <FaceCrop src={thumbSrc({ event: event.slug, id: person.cover.itemId }, 800)} box={person.cover.box} className="w-20 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h1 className="display text-4xl md:text-5xl text-balance break-words">{title}</h1>
          <p className="text-sm text-subtle mt-1">
            {items.length} {items.length === 1 ? "photo" : "photos"}, grouped automatically
            {person.hidden && ". Hidden from the team"}
          </p>
        </div>
        {admin && <PersonControls slug={event.slug} person={{ id: person.id, name: person.name ?? "", hidden: person.hidden }} />}
      </div>

      {items.length > 0 ? (
        <Gallery
          path={[]}
          folderName={title}
          items={items}
          downloadAll={items.map(({ event: e, id: itemId }) => ({ event: e, id: itemId }))}
          listedOrder="Newest"
          canShare
          showDetails={admin}
        />
      ) : (
        <div className="py-24 text-center">
          <p className="display text-3xl">No photos left</p>
          <p className="text-subtle mt-2">This person&apos;s photos were removed from the event.</p>
        </div>
      )}
    </>
  );
}
