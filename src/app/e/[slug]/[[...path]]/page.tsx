import { notFound, redirect } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { ShareFolderButton } from "@/components/share-folder-button";
import { getEvent } from "@/lib/events";
import { browseHref, cleanName, withPreviews } from "@/lib/format";
import { getFolder, NotFoundError } from "@/lib/onedrive/client";
import { getEventDownloads } from "@/lib/downloads";
import { getEventLikes } from "@/lib/likes";
import { listShares, ownerFilter, shareOwner } from "@/lib/shares";
import { isPending, listUsers } from "@/lib/users";

export const dynamic = "force-dynamic";

function decode(seg: string) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export async function generateMetadata({ params }: PageProps<"/e/[slug]/[[...path]]">) {
  const { slug, path = [] } = await params;
  const event = await getEvent(decode(slug));
  const name = path.length ? cleanName(decode(path.at(-1)!)) : event?.title;
  return { title: `${name ?? "Event"} · Strategic Media Manager` };
}

export default async function EventFolderPage({ params }: PageProps<"/e/[slug]/[[...path]]">) {
  const { slug: rawSlug, path: rawPath = [] } = await params;
  const event = await getEvent(decode(rawSlug));
  if (!event) notFound();
  const path = rawPath.map(decode);

  const result = await getFolder(event.share_url, path).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const items = result.items.map((i) => withPreviews({ ...i, event: event.slug }));
  const title = path.length ? cleanName(result.folder.name) : event.title;
  // null when the shares table doesn't exist yet (migration 0003 not run).
  const session = await getSession();
  if (!session) redirect("/login");
  const [shares, likes, users, downloads] = await Promise.all([
    listShares({ eventId: event.id, folderId: result.folder.id, createdBy: ownerFilter(session) }).catch(() => null),
    getEventLikes(event.id, event.slug, shareOwner(session), session.role === "admin").catch(() => ({})),
    listUsers().catch(() => []),
    getEventDownloads(event.id, event.slug).catch(() => ({})),
  ]);
  const admin = session.role === "admin";
  const activeUsers = users.filter((u) => !isPending(u)).map((u) => ({ email: u.email, label: u.name || u.email }));
  const coordinator = event.coordinator_email;
  const coordinatorName = activeUsers.find((u) => u.email === coordinator)?.label ?? coordinator;
  // The coordinator doesn't request from themselves; migration 0011 not run means no coordinator (undefined).
  const canRequest = !!coordinator && session.email !== coordinator;

  return (
    <>
      <Breadcrumbs base={browseHref(event.slug)} rootLabel={event.title} path={path} />
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <h1 className="display text-4xl md:text-5xl flex-1 min-w-0 text-balance">{title}</h1>
        <ShareFolderButton event={event.slug} folderId={result.folder.id} folderPath={path} folderName={title} shares={shares} />
      </div>
      <Gallery path={path} folder={{ event: event.slug, id: result.folder.id }} folderName={title} items={items} canShare showDetails={admin} likes={likes} downloads={downloads} requestTo={canRequest ? coordinatorName! : undefined} />
    </>
  );
}
