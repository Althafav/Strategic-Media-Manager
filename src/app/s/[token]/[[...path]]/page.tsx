import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, Link2Off } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { Gallery } from "@/components/gallery";
import { ShareStatus } from "@/components/share-link-actions";
import { cleanName, downloadHref, formatBytes, shareHref } from "@/lib/format";
import { getFolder, getItems, NotFoundError } from "@/lib/onedrive/client";
import type { MediaItem } from "@/lib/onedrive/types";
import { getActiveShare, signItem } from "@/lib/shares";

export const dynamic = "force-dynamic";

function decode(seg: string) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

// A missing table or bad token both mean "no access".
const lookup = (token: string) => getActiveShare(token).catch(() => null);

const orNotFound = (e: unknown): never => {
  if (e instanceof NotFoundError) notFound();
  throw e;
};

export async function generateMetadata({ params }: PageProps<"/s/[token]/[[...path]]">): Promise<Metadata> {
  const { token, path = [] } = await params;
  const active = await lookup(token);
  const name = path.length ? decode(path.at(-1)!) : active?.share.folder_name;
  return {
    title: `${name ? cleanName(name) : "Shared folder"} · Strategic Media`,
    robots: { index: false, follow: false },
  };
}

/**
 * Public view of one share link: a folder subtree, or a hand-picked set of items (`item_ids`)
 * where only picked folders can be opened. No login.
 */
export default async function SharedPage({ params }: PageProps<"/s/[token]/[[...path]]">) {
  const { token, path: rawPath = [] } = await params;
  const active = await lookup(token);
  if (!active) {
    return (
      <div className="py-24 text-center max-w-md mx-auto">
        <Link2Off className="size-10 text-subtle mx-auto" />
        <h1 className="display text-3xl mt-4">This link has expired or was removed</h1>
        <p className="text-subtle mt-1">Ask the person who shared it with you for a new link.</p>
      </div>
    );
  }

  const { share, event } = active;
  const path = rawPath.map(decode);
  const picked = share.item_ids?.length ? share.item_ids : null;

  // Sign every item so the media APIs can check it belongs to this share.
  const signed = <T extends { id: string }>(i: T) => ({ ...i, event: event.slug, t: token, sig: signItem(token, i.id) });

  let folder: { id: string } | undefined;
  let items: MediaItem[];
  if (picked) {
    const pickedItems = await getItems(event.share_url, picked, share.folder_id);
    if (path.length) {
      // Inside a picked folder: its first segment must name one of the picked folders.
      const root = pickedItems.find((i) => i.kind === "folder" && i.name === path[0]);
      if (!root) notFound();
      const result = await getFolder(event.share_url, path.slice(1), root.id).catch(orNotFound);
      folder = result.folder;
      items = result.items.map(signed);
    } else {
      items = pickedItems.map(signed);
    }
  } else {
    const result = await getFolder(event.share_url, path, share.folder_id ?? undefined).catch(orNotFound);
    folder = result.folder;
    items = result.items.map(signed);
  }

  const title = cleanName(path.length ? path.at(-1)! : share.folder_name);
  const single = picked && !path.length && items.length === 1 && items[0].isImage ? items[0] : null;
  const allPhotos = items.every((i) => i.isImage);
  const scope =
    !picked || path.length
      ? "everything in this folder"
      : single
        ? "this photo"
        : `these ${items.length} ${allPhotos ? "photos" : "items"}`;

  return (
    <>
      <div className="mt-5 border-l-4 border-pencil bg-surface px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="flex-1 min-w-60">
          <strong className="font-semibold">Shared with you by Strategic.</strong>{" "}
          <span className="text-subtle">You can view and download {scope}.</span>
        </p>
        <span className="text-subtle">
          <ShareStatus share={share} />
        </span>
      </div>
      <Breadcrumbs base={shareHref(token)} rootLabel={share.folder_name} path={path} showEvents={false} />
      <h1 className="display text-4xl md:text-5xl mt-3 text-balance break-words">{title}</h1>
      {single ? (
        <SingleFile item={single} />
      ) : picked && !path.length && !items.length ? (
        <p className="py-24 text-center text-subtle">The shared files have been moved or deleted.</p>
      ) : (
        <Gallery
          path={path}
          base={shareHref(token, path)}
          folder={folder && signed(folder)}
          downloadAll={picked && !path.length ? items : undefined}
          folderName={title}
          items={items}
        />
      )}
    </>
  );
}

/** A link to one photo: show it large with a download button instead of a one-tile grid. */
function SingleFile({ item }: { item: MediaItem }) {
  const src = item.preview ?? item.thumb;
  return (
    <figure className="mt-6">
      <div className="bg-muted grid place-items-center min-h-60">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={item.name} className="max-h-[75vh] w-auto max-w-full object-contain" />
        ) : (
          <p className="text-subtle py-24">No preview for this file.</p>
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-3 mt-3">
        <span className="text-sm text-subtle flex-1 min-w-0 truncate">
          {item.name}, {formatBytes(item.size)}
          {item.width && item.height ? `, ${item.width} × ${item.height}` : ""}
        </span>
        <a
          href={downloadHref(item)}
          className="h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2"
        >
          <Download className="size-4" /> Download
        </a>
      </figcaption>
    </figure>
  );
}
