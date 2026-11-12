import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Download, Link2Off, Plus } from "lucide-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { FindMyPhotos } from "@/components/features/faces/find-my-photos";
import { Gallery } from "@/components/gallery";
import { ShareStatus } from "@/components/share-link-actions";
import { getSession } from "@/lib/auth";
import { browseHref, cleanName, downloadHref, formatBytes, shareHref, withPreviews } from "@/lib/format";
import { getFolder, getItems, NotFoundError } from "@/lib/onedrive/client";
import type { MediaItem } from "@/lib/onedrive/types";
import { canViewShare } from "@/lib/share-emails";
import { parsePicks, type ShareRow } from "@/lib/share-types";
import { getActiveShare, shareOwner, signItem, verifyItem } from "@/lib/shares";
import { EmailGate } from "../email-gate";

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
  // Before the email gate, don't reveal the folder name.
  const name = !active || !(await canViewShare(token)) ? null : path.length ? decode(path.at(-1)!) : active.share.folder_name;
  return {
    title: `${name ? cleanName(name) : "Shared folder"} · Strategic Media`,
    robots: { index: false, follow: false },
  };
}

/**
 * Public view of one share link: a folder subtree, or a hand-picked set of items (`item_ids`)
 * where only picked folders can be opened. No login, but visitors must enter an email first (lib/share-emails.ts);
 * team members skip that.
 */
export default async function SharedPage({ params, searchParams }: PageProps<"/s/[token]/[[...path]]">) {
  const { token, path: rawPath = [] } = await params;
  // A visitor's copied selection (`picksHref`): only at the link's root.
  const { i } = await searchParams;
  const rawPicks = !rawPath.length && typeof i === "string" && i ? i : null;
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

  const path = rawPath.map(decode);
  // Nothing from OneDrive is loaded until the visitor has entered an email.
  if (!(await canViewShare(token))) {
    const back = rawPicks ? `${shareHref(token)}?i=${encodeURIComponent(rawPicks)}` : shareHref(token, path);
    return <EmailGate token={token} back={back} />;
  }

  const { share, event } = active;

  // Sign every item so the media APIs can check it belongs to this share, and build its /api/thumb
  // URLs (carrying t/sig) so no raw OneDrive URL reaches the page. See SECURITY.md.
  const signed = <T extends { id: string; hasThumb?: boolean }>(i: T) =>
    withPreviews({ ...i, event: event.slug, t: token, sig: signItem(token, i.id) });

  if (rawPicks) {
    // Each signature was issued by this page for an item inside the link, so a valid one proves the item belongs here.
    const picks = parsePicks(rawPicks)?.filter((p) => verifyItem(token, p.id, p.sig));
    if (!picks?.length) notFound();
    const found = await getItems(event.share_url, picks.map((p) => p.id), share.folder_id);
    // Files only: a folder would need its own route to be opened from here.
    return <Picks share={share} items={found.filter((f) => f.kind === "file").map(signed)} />;
  }

  const picked = share.item_ids?.length ? share.item_ids : null;
  // The link's creator and the admin can add items to a picked-items link (addShareItems); they get a note at its root.
  const session = picked && !path.length ? await getSession() : null;
  const canAdd =
    !!session &&
    (session.role === "admin" || (shareOwner(session) === share.created_by && !event.hidden));

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
  const single = picked && !path.length ? singlePhoto(items) : null;
  const scope = !picked || path.length ? "everything in this folder" : pickedScope(items);

  const gallery = (
    <Gallery
      path={path}
      base={shareHref(token, path)}
      folder={folder && signed(folder)}
      downloadAll={picked && !path.length ? items : undefined}
      folderName={title}
      items={items}
    />
  );

  return (
    <>
      <SharedBanner share={share} scope={scope} />
      {canAdd && (
        <div className="mt-2 border border-border bg-surface rounded-md px-4 py-3 text-sm flex flex-wrap items-center gap-x-6 gap-y-2">
          <p className="flex-1 min-w-60">
            <strong className="font-semibold">You can add to this link.</strong>{" "}
            <span className="text-subtle">
              Select photos or folders in the event, choose Share, then pick this link. Only you and the admin see this note.
            </span>
          </p>
          <Link
            href={browseHref(event.slug, share.folder_path)}
            className="h-9 px-3 rounded-md border border-border text-sm font-medium inline-flex items-center gap-2 hover:border-foreground"
          >
            <Plus className="size-4" /> Add photos
          </Link>
        </div>
      )}
      <Breadcrumbs base={shareHref(token)} rootLabel={share.folder_name} path={path} showEvents={false} />
      <h1 className="display text-4xl md:text-5xl mt-3 text-balance break-words">{title}</h1>
      {single ? (
        <SingleFile item={single} />
      ) : picked && !path.length && !items.length ? (
        <p className="py-24 text-center text-subtle">The shared files have been moved or deleted.</p>
      ) : event.face_search ? (
        <FindMyPhotos token={token}>{gallery}</FindMyPhotos>
      ) : (
        gallery
      )}
    </>
  );
}

/** A lone photo gets the large single view. */
const singlePhoto = (items: MediaItem[]) => (items.length === 1 && items[0].isImage ? items[0] : null);

const pickedNoun = (items: MediaItem[]) => (items.every((i) => i.isImage) ? "photos" : "items");

const pickedScope = (items: MediaItem[]) => (singlePhoto(items) ? "this photo" : `these ${items.length} ${pickedNoun(items)}`);

function SharedBanner({ share, scope }: { share: ShareRow; scope: string }) {
  return (
    <div className="mt-5 border-l-4 border-pencil bg-surface px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-6 gap-y-1">
      <p className="flex-1 min-w-60">
        <strong className="font-semibold">Shared with you by Strategic.</strong>{" "}
        <span className="text-subtle">You can view and download {scope}.</span>
      </p>
      <span className="text-subtle">
        <ShareStatus share={share} />
      </span>
    </div>
  );
}

/**
 * A visitor's copied selection (`picksHref`): some files of this link, shown like a picked-items link.
 * The breadcrumb leads to the whole link, which the same token opens anyway.
 */
function Picks({ share, items }: { share: ShareRow; items: MediaItem[] }) {
  const single = singlePhoto(items);
  const from = cleanName(share.folder_name);
  return (
    <>
      <SharedBanner share={share} scope={pickedScope(items)} />
      <Breadcrumbs base={shareHref(share.token)} rootLabel={share.folder_name} path={["Selection"]} showEvents={false} />
      <h1 className="display text-4xl md:text-5xl mt-3 text-balance break-words">
        {single ? "A photo picked for you" : `${items.length} ${pickedNoun(items)} picked for you`}
      </h1>
      {single ? (
        <SingleFile item={single} />
      ) : items.length ? (
        <Gallery path={[]} base={shareHref(share.token)} downloadAll={items} folderName={`${from} - selection`} items={items} />
      ) : (
        <p className="py-24 text-center text-subtle">The shared files have been moved or deleted.</p>
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
