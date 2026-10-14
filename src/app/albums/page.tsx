import Link from "next/link";
import { redirect } from "next/navigation";
import { Album, Users } from "lucide-react";
import { getSession } from "@/lib/auth";
import { albumCovers, listAlbums, type AlbumSummary } from "@/lib/albums";
import { listVisibleEvents } from "@/lib/events";
import { formatDate } from "@/lib/share-types";
import { listUsers } from "@/lib/users";
import { NewAlbumButton } from "./new-album-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Albums · Strategic Media Manager" };

export default async function AlbumsPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/albums");

  let albums: { own: AlbumSummary[]; shared: AlbumSummary[] };
  try {
    albums = await listAlbums(session);
  } catch (e) {
    return (
      <>
        <Heading />
        <p className="mt-6 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{(e as Error).message}</p>
      </>
    );
  }

  const [events, users] = await Promise.all([listVisibleEvents(), listUsers().catch(() => [])]);
  const covers = await albumCovers([...albums.own, ...albums.shared].map((a) => a.id), events);
  const nameByEmail = new Map(users.map((u) => [u.email, u.name || u.email]));
  const person = (who: string) => (who === "admin" ? "Admin" : (nameByEmail.get(who) ?? who));

  return (
    <>
      <div className="pt-10 flex flex-wrap items-end gap-4">
        <Heading />
        <div className="ml-auto">
          <NewAlbumButton />
        </div>
      </div>

      {albums.own.length === 0 ? (
        <p className="py-16 text-center text-subtle">
          No albums yet. Select photos in any event or in search results and choose <strong>Add to album</strong>, or make an
          empty one with <strong>New album</strong>.
        </p>
      ) : (
        <AlbumGrid albums={albums.own} covers={covers} meta={(a) => (a.shared_with.length ? `Shared with ${a.shared_with.length}` : null)} />
      )}

      {albums.shared.length > 0 && (
        <>
          <h2 className="display text-3xl mt-12">Shared with you</h2>
          <AlbumGrid albums={albums.shared} covers={covers} meta={(a) => `From ${person(a.created_by)}`} />
        </>
      )}
    </>
  );
}

function Heading() {
  return (
    <div>
      <h1 className="display text-5xl">Albums</h1>
      <p className="text-subtle mt-1">Your own collections of photos from any event. The files stay where they are in OneDrive.</p>
    </div>
  );
}

function AlbumGrid(props: { albums: AlbumSummary[]; covers: Record<string, string>; meta: (a: AlbumSummary) => string | null }) {
  const { albums, covers, meta } = props;
  return (
    <ul className="mt-6 grid gap-x-4 gap-y-6 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
      {albums.map((a) => {
        const extra = meta(a);
        return (
          <li key={a.id}>
            <Link href={`/albums/${a.id}`} className="group block">
              <div className="aspect-[4/3] bg-muted overflow-hidden grid place-items-center">
                {covers[a.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- /api/thumb 302s to OneDrive; next/image can't proxy it
                  <img src={covers[a.id]} alt="" loading="lazy" className="size-full object-cover group-hover:opacity-90" />
                ) : (
                  <Album className="size-8 text-subtle" aria-hidden />
                )}
              </div>
              <p className="mt-2 font-medium truncate group-hover:underline underline-offset-4">{a.name}</p>
              <p className="text-xs text-subtle flex items-center gap-1.5">
                {a.count} {a.count === 1 ? "item" : "items"}, updated {formatDate(a.updated_at)}
              </p>
              {extra && (
                <p className="text-xs text-subtle flex items-center gap-1.5 truncate">
                  <Users className="size-3" aria-hidden /> {extra}
                </p>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
