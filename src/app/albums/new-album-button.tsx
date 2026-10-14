"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, Loader2 } from "lucide-react";
import { ShareDialog } from "@/components/share-folder-button";
import { MAX_ALBUM_NAME } from "@/lib/album-types";
import { createAlbumAction } from "./actions";

/** "New album" on /albums: names an empty album and opens it. */
export function NewAlbumButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpened((n) => n + 1);
          dialog.current?.showModal();
        }}
        className="h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2"
      >
        <FolderPlus className="size-4" /> New album
      </button>
      <ShareDialog ref={dialog} title="New album" description="Then add photos to it from any event: select them and choose Add to album.">
        {opened > 0 && <NewAlbumForm key={opened} />}
      </ShareDialog>
    </>
  );
}

function NewAlbumForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<{ error?: string; id?: string }, FormData>(createAlbumAction, {});
  useEffect(() => {
    if (state.id) router.push(`/albums/${state.id}`);
  }, [state.id, router]);

  return (
    <form action={action} className="space-y-3">
      <input
        name="name"
        required
        autoFocus
        maxLength={MAX_ALBUM_NAME}
        pattern=".*\S.*"
        title="Give the album a name."
        placeholder="e.g. Opening ceremony highlights"
        aria-label="Album name"
        className="w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      {state.error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
          {state.error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          disabled={pending || !!state.id}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
        >
          {pending || state.id ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />} Create album
        </button>
      </div>
    </form>
  );
}
