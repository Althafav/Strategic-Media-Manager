import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { albumMedia, getAlbum, isAlbumOwner } from "@/lib/albums";
import { listVisibleEvents } from "@/lib/events";
import { formatDate } from "@/lib/share-types";
import { listUsers } from "@/lib/users";
import { removeFromAlbumAction } from "../actions";
import { AlbumControls } from "./album-controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Album · Strategic Media Manager" };

/**
 * One album in the regular gallery: grid, lightbox, select + download/zip/share. The owner can rename, share with
 * team members, remove items and delete it; people it's shared with can view and download. Anyone else gets a 404.
 */
export default async function AlbumPage({ params }: PageProps<"/albums/[id]">) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect(`/login?next=/albums/${encodeURIComponent(id)}`);
  const album = await getAlbum(session, id);
  if (!album) notFound();

  const owner = isAlbumOwner(session, album);
  const [events, users] = await Promise.all([listVisibleEvents(), listUsers().catch(() => [])]);
  const { items, hidden } = await albumMedia(album.id, events);
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (who: string) => (who === "admin" ? "Admin" : (nameByEmail.get(who) ?? who));

  return (
    <>
      <div className="pt-6">
        <Link href="/albums" className="text-sm text-subtle hover:text-foreground inline-flex items-center gap-1.5">
          <ArrowLeft className="size-4" /> Albums
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex-1 min-w-0">
          <h1 className="display text-4xl md:text-5xl text-balance break-words">{album.name}</h1>
          <p className="text-sm text-subtle mt-1">
            {owner ? "Your album" : `Shared with you by ${person(album.created_by)}`}, made {formatDate(album.created_at)}
            {owner && album.shared_with.length > 0 && `, shared with ${album.shared_with.map(person).join(", ")}`}
          </p>
        </div>
        {owner && (
          <AlbumControls
            album={{ id: album.id, name: album.name, sharedWith: album.shared_with }}
            users={users
              .filter((u) => u.status !== "pending" && u.email !== session.email?.toLowerCase())
              .map((u) => ({ email: u.email, label: u.name || u.email }))}
            items={items}
          />
        )}
      </div>

      {hidden > 0 && (
        <p className="mt-4 text-sm rounded-md border border-border bg-surface px-3 py-2 text-subtle">
          {hidden} {hidden === 1 ? "item is" : "items are"} from an event you can&apos;t open, so {hidden === 1 ? "it isn't" : "they aren't"} shown.
        </p>
      )}

      {items.length > 0 ? (
        <Gallery
          path={[]}
          folderName={album.name}
          items={items}
          downloadAll={items.map(({ event, id: itemId }) => ({ event, id: itemId }))}
          listedOrder="Added"
          canShare
          showDetails={session.role === "admin"}
          removeSelected={owner ? removeFromAlbumAction.bind(null, album.id) : undefined}
        />
      ) : (
        <div className="py-24 text-center">
          <p className="display text-3xl">This album is empty</p>
          <p className="text-subtle mt-2">
            {owner
              ? "Select photos in any event or in search results, then choose Add to album."
              : "Nothing has been added yet."}
          </p>
        </div>
      )}
    </>
  );
}
