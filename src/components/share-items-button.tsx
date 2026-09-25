"use client";

import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { cleanName } from "@/lib/format";
import { MAX_SHARE_ITEMS } from "@/lib/share-types";
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

  const events = new Set(items.map((i) => i.event));
  const allImages = items.every((i) => i.kind === "file" && i.isImage);
  const noun = allImages ? ["photo", "photos"] : ["item", "items"];
  const name =
    items.length === 1
      ? items[0].kind === "folder"
        ? cleanName(items[0].name)
        : items[0].name
      : `${items.length} ${noun[1]}${folderName ? ` from ${cleanName(folderName)}` : ""}`;
  // Search results: remember the folder when every pick came from the same one.
  const locations = new Set(items.map((i) => (i.location ?? folderPath).join("/")));
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
          dialog.current?.showModal();
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
              key={opened}
              fields={{
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
