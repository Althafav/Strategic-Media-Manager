"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import { Album, FolderPlus, Loader2 } from "lucide-react";
import { addToAlbumAction, listOwnAlbumsAction, type AddToAlbumState } from "@/app/albums/actions";
import { MAX_ALBUM_ITEMS, MAX_ALBUM_NAME, type AlbumPick, type AlbumRow } from "@/lib/album-types";
import type { MediaItem } from "@/lib/onedrive/types";
import { ShareDialog } from "./share-folder-button";

type AlbumOption = Pick<AlbumRow, "id" | "name">;

const field =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** "Add to album" in the selection bar: puts the selected items in one of your albums, or a new one. */
export function AddToAlbumButton({ items, folderPath }: { items: MediaItem[]; folderPath: string[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Remount the form on every open so it carries the current selection and no stale result.
  const [opened, setOpened] = useState(0);
  const [albums, setAlbums] = useState<AlbumOption[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const open = () => {
    setOpened((n) => n + 1);
    setAlbums(null);
    setLoadError(null);
    dialog.current?.showModal();
    void listOwnAlbumsAction().then((res) => {
      if (res.error) setLoadError(res.error);
      setAlbums(res.albums ?? []);
    });
  };

  const noun = items.length === 1 ? "item" : "items";
  // Each pick keeps its own folder: the selection can span folders and events.
  const picks: AlbumPick[] = items.map(({ event, id, name, kind, location }) => ({ event, id, name, kind, path: location ?? folderPath }));

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="h-9 px-3 rounded-md border border-white/25 text-sm font-medium inline-flex items-center gap-2 hover:bg-white/10"
      >
        <Album className="size-4" /> Add to album
      </button>
      <ShareDialog
        ref={dialog}
        title={`Add ${items.length} ${noun} to an album`}
        description="Albums are your own collections. The files stay where they are in OneDrive; only you can change the album, and you can share it with team members."
      >
        {items.length > MAX_ALBUM_ITEMS ? (
          <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            An album can hold up to {MAX_ALBUM_ITEMS} items. Select fewer and try again.
          </p>
        ) : albums === null ? (
          <p className="text-sm text-subtle inline-flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" /> Loading your albums…
          </p>
        ) : loadError ? (
          <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
            {loadError}
          </p>
        ) : (
          opened > 0 && <AddForm key={opened} albums={albums} picks={picks} />
        )}
      </ShareDialog>
    </>
  );
}

function AddForm({ albums, picks }: { albums: AlbumOption[]; picks: AlbumPick[] }) {
  const [state, action, pending] = useActionState<AddToAlbumState, FormData>(addToAlbumAction, {});
  const [list, setList] = useState(albums);
  const [choice, setChoice] = useState(albums[0]?.id ?? "new");
  const added = state.added;
  // A new album just made: list and pick it, so pressing the button again doesn't make a second one.
  const [seen, setSeen] = useState(added);
  if (added !== seen) {
    setSeen(added);
    if (added && !list.some((a) => a.id === added.album.id)) {
      setList([added.album, ...list]);
      setChoice(added.album.id);
    }
  }
  const skipped = added ? picks.length - added.count : 0;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="items" value={JSON.stringify(picks)} />
      <fieldset>
        <legend className="text-sm font-medium mb-1.5">Album</legend>
        <ul className="max-h-60 overflow-y-auto rounded-md border border-border divide-y divide-border">
          <li>
            <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
              <input
                type="radio"
                name="album"
                value="new"
                checked={choice === "new"}
                onChange={() => setChoice("new")}
                className="size-4 accent-[var(--color-accent)]"
              />
              <FolderPlus className="size-4 text-subtle" aria-hidden /> New album
            </label>
            {choice === "new" && (
              <div className="px-3 pb-3">
                <input
                  name="name"
                  required
                  autoFocus
                  maxLength={MAX_ALBUM_NAME}
                  pattern=".*\S.*"
                  title="Give the album a name."
                  placeholder="e.g. Opening ceremony highlights"
                  aria-label="New album name"
                  className={field}
                />
              </div>
            )}
          </li>
          {list.map((a) => (
            <li key={a.id}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                <input
                  type="radio"
                  name="album"
                  value={a.id}
                  checked={choice === a.id}
                  onChange={() => setChoice(a.id)}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 truncate">{a.name}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
          {state.error}
        </p>
      )}
      {added && (
        <p role="status" className="text-sm rounded-md border border-green-600/30 bg-green-600/10 px-3 py-2">
          {added.count ? `Added ${added.count} to “${added.album.name}”.` : `Everything was already in “${added.album.name}”.`}
          {added.count > 0 && skipped > 0 && ` ${skipped} ${skipped === 1 ? "was" : "were"} already in it.`}{" "}
          <Link href={`/albums/${added.album.id}`} className="underline underline-offset-4 font-medium">
            Open album
          </Link>
        </p>
      )}

      <div className="flex justify-end">
        <button
          disabled={pending}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Album className="size-4" />}
          {choice === "new" ? "Create album" : "Add to album"}
        </button>
      </div>
    </form>
  );
}
