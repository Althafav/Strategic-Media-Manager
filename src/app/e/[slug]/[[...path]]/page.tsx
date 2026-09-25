import { notFound } from "next/navigation";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Gallery } from "@/components/gallery";
import { ShareFolderButton } from "@/components/share-folder-button";
import { getEvent } from "@/lib/events";
import { browseHref, cleanName } from "@/lib/format";
import { getFolder, NotFoundError } from "@/lib/onedrive/client";
import { listShares } from "@/lib/shares";

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
  const items = result.items.map((i) => ({ ...i, event: event.slug }));
  const title = path.length ? cleanName(result.folder.name) : event.title;
  // null when the shares table doesn't exist yet (migration 0003 not run).
  const shares = await listShares({ eventId: event.id, folderId: result.folder.id }).catch(() => null);

  return (
    <>
      <Breadcrumbs base={browseHref(event.slug)} rootLabel={event.title} path={path} />
      <div className="flex flex-wrap items-end gap-3 mt-3">
        <h1 className="display text-4xl md:text-5xl flex-1 min-w-0 text-balance">{title}</h1>
        <ShareFolderButton event={event.slug} folderId={result.folder.id} folderPath={path} folderName={title} shares={shares} />
      </div>
      <Gallery path={path} folder={{ event: event.slug, id: result.folder.id }} folderName={title} items={items} canShare />
    </>
  );
}
