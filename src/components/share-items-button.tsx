"use client";

import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { cleanName } from "@/lib/format";
import { listOwnItemLinksAction } from "@/app/shares/actions";
import { MAX_SHARE_ITEMS, type LinkOption } from "@/lib/share-types";
import { AllLinks, CreateShareForm, ShareDialog } from "./share-folder-button";

type Props = {
  items: MediaItem[];
  /** The folder the items were picked from; omitted for search results. */
  folderId?: string;
  folderPath: string[];
  folderName?: string;
};

/** "Share" in the selection bar: a link to exactly the selected photos/files. */
export function ShareItemsButton({ items, folderId, folderPath, folderName }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Remount the form on every open so the previous link doesn't linger.
  const [opened, setOpened] = useState(0);
  // Your picked-items links for this event, to add the selection to one instead; null while loading.
  const [links, setLinks] = useState<LinkOption[] | null>(null);

  const events = new Set(items.map((i) => i.event));
  const allImages = items.every((i) => i.kind === "file" && i.isImage);
  const noun = allImages ? ["photo", "photos"] : ["item", "items"];
  // Search results or picks from several folders: remember the folder when every pick came from the same one.
  const locations = new Set(items.map((i) => (i.location ?? folderPath).join("/")));
  const from = folderName ? ` from ${cleanName(folderName)}` : locations.size > 1 ? ` from ${locations.size} folders` : "";
  const name =
    items.length === 1
      ? items[0].kind === "folder"
        ? cleanName(items[0].name)
        : items[0].name
      : `${items.length} ${noun[1]}${from}`;
  const path = locations.size === 1 ? (items[0].location ?? folderPath) : [];

  let problem: string | null = null;
  if (events.size > 1) problem = "These items come from different events. Pick items from one event to share them together.";
  else if (items.length > MAX_SHARE_ITEMS) problem = `A link can hold up to ${MAX_SHARE_ITEMS} items. Select fewer and try again.`;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened((n) => n + 1);
          setLinks(null);
          dialog.current?.showModal();
          // A failed lookup just means only "new link" is offered.
          if (!problem) {
            void listOwnItemLinksAction(items[0]?.event ?? "")
              .then((res) => setLinks(res.links))
              .catch(() => setLinks([]));
          }
        }}
        className="h-9 px-3 rounded-md border border-white/25 text-sm font-medium inline-flex items-center gap-2 hover:bg-white/10"
      >
        <Share2 className="size-4" /> Share
      </button>

      <ShareDialog
        ref={dialog}
        title={`Share ${items.length === 1 ? `“${name}”` : name}`}
        description={`Anyone with the link can view and download only ${
          items.length === 1 ? `this ${items[0].kind === "folder" ? "folder" : noun[0]}` : `these ${items.length} ${noun[1]}`
        }, without logging in. They can't see anything else${items.some((i) => i.kind === "folder") ? " (shared folders include their subfolders)" : ""}.`}
      >
        {problem ? (
          <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{problem}</p>
        ) : (
          opened > 0 && (
            <CreateShareForm
              // The list arrives a moment after opening; remounting then is fine, nothing is typed yet.
              key={`${opened}:${links ? "ready" : "loading"}`}
              existing={links ?? []}
              fields={{
                allImages: allImages ? "yes" : "no",
                event: items[0]?.event ?? "",
                itemIds: JSON.stringify(items.map((i) => i.id)),
                folderId: folderId ?? "",
                folderPath: JSON.stringify(path),
                folderName: name,
              }}
            />
          )
        )}
        <AllLinks />
      </ShareDialog>
    </>
  );
}
