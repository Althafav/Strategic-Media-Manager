"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Save, Share2, Trash2 } from "lucide-react";
import { AllLinks, CreateShareForm, ShareDialog } from "@/components/share-folder-button";
import { MAX_ALBUM_NAME } from "@/lib/album-types";
import type { MediaItem } from "@/lib/onedrive/types";
import { commonPath } from "@/lib/request-types";
import { MAX_SHARE_ITEMS } from "@/lib/share-types";
import { deleteAlbumAction, renameAlbumAction, shareAlbumAction } from "../actions";

type TeamMember = { email: string; label: string };
type Props = {
  album: { id: string; name: string; sharedWith: string[] };
  /** Active team members other than the owner. */
  users: TeamMember[];
  /** What the owner sees of the album, for a share link. */
  items: MediaItem[];
};

const button =
  "h-9 px-3 rounded-md border border-border bg-surface text-sm font-medium inline-flex items-center gap-2 hover:border-foreground disabled:opacity-60";
const field =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** The owner's buttons on an album page: Share (team members + a link), Rename, Delete. */
export function AlbumControls({ album, users, items }: Props) {
  const router = useRouter();
  const shareDialog = useRef<HTMLDialogElement>(null);
  const renameDialog = useRef<HTMLDialogElement>(null);
  // Remount the dialogs' forms on every open so they start from the saved album.
  const [opened, setOpened] = useState(0);
  const [deleting, startDelete] = useTransition();

  const show = (dialog: HTMLDialogElement | null) => {
    setOpened((n) => n + 1);
    dialog?.showModal();
  };

  return (
    <div className="flex gap-2">
      <button type="button" className={button} onClick={() => show(shareDialog.current)}>
        <Share2 className="size-4" /> Share
      </button>
      <button type="button" className={button} onClick={() => show(renameDialog.current)}>
        <Pencil className="size-4" /> Rename
      </button>
      <button
        type="button"
        disabled={deleting}
        aria-label="Delete album"
        title="Delete album"
        className={`${button} text-subtle hover:text-red-600 hover:border-red-500/40`}
        onClick={() => {
          if (!window.confirm(`Delete the album “${album.name}”? The files stay in OneDrive; only the album goes.`)) return;
          startDelete(async () => {
            const res = await deleteAlbumAction(album.id);
            if (res.error) window.alert(res.error);
            else router.push("/albums");
          });
        }}
      >
        {deleting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>

      <ShareDialog
        ref={shareDialog}
        title={`Share “${album.name}”`}
        description="Team members you pick can open and download this album, but only you can change it. For people outside the team, make a link."
      >
        {opened > 0 && <TeamSharing key={opened} album={album} users={users} />}
        <LinkSharing album={album} items={items} opened={opened} />
      </ShareDialog>

      <ShareDialog ref={renameDialog} title="Rename album" description="The new name shows for everyone it's shared with.">
        {opened > 0 && <RenameForm key={opened} album={album} onDone={() => renameDialog.current?.close()} />}
      </ShareDialog>
    </div>
  );
}

function TeamSharing({ album, users }: { album: Props["album"]; users: TeamMember[] }) {
  const router = useRouter();
  const [picked, setPicked] = useState(album.sharedWith);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ error?: string; saved?: boolean } | null>(null);
  // People removed from Users since stay listed, so they can be unticked.
  const options = [...users, ...album.sharedWith.filter((e) => !users.some((u) => u.email === e)).map((email) => ({ email, label: email }))];
  const changed = picked.length !== album.sharedWith.length || picked.some((e) => !album.sharedWith.includes(e));

  return (
    <section>
      <h3 className="text-sm font-medium">Team members</h3>
      {options.length === 0 ? (
        <p className="text-sm text-subtle mt-1">No other team members yet.</p>
      ) : (
        <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
          {options.map((u) => (
            <li key={u.email}>
              <label className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted">
                <input
                  type="checkbox"
                  checked={picked.includes(u.email)}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setResult(null);
                    setPicked((p) => (on ? [...p, u.email] : p.filter((x) => x !== u.email)));
                  }}
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 truncate">{u.label}</span>
                {u.label !== u.email && <span className="ml-auto text-xs text-subtle truncate">{u.email}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-3">
        {result?.error && (
          <p role="alert" className="flex-1 text-sm text-red-600">
            {result.error}
          </p>
        )}
        {result?.saved && (
          <p role="status" className="flex-1 text-sm text-green-700 dark:text-green-400">
            Saved.
          </p>
        )}
        <button
          type="button"
          disabled={pending || !changed}
          onClick={() =>
            start(async () => {
              const res = await shareAlbumAction(album.id, picked);
              setResult(res.error ? res : { saved: true });
              if (!res.error) router.refresh();
            })
          }
          className="ml-auto h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </button>
      </div>
    </section>
  );
}

/** A regular picked-items share link for the whole album (share links cover one event, up to MAX_SHARE_ITEMS). */
function LinkSharing({ album, items, opened }: { album: Props["album"]; items: MediaItem[]; opened: number }) {
  const events = new Set(items.map((i) => i.event));
  let problem: string | null = null;
  if (!items.length) problem = "Add photos to the album first.";
  else if (events.size > 1)
    problem = `This album has items from ${events.size} events, and a link can cover one event. Select the items from one event in the album and use Share in the selection bar.`;
  else if (items.length > MAX_SHARE_ITEMS) problem = `A link can hold up to ${MAX_SHARE_ITEMS} items. Select fewer in the album and use Share in the selection bar.`;

  return (
    <section className="border-t border-border pt-5 space-y-3">
      <h3 className="text-sm font-medium">Link for people outside the team</h3>
      {problem ? (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{problem}</p>
      ) : (
        opened > 0 && (
          <CreateShareForm
            key={opened}
            fields={{
              event: items[0].event,
              itemIds: JSON.stringify(items.map((i) => i.id)),
              folderId: "",
              folderPath: JSON.stringify(commonPath(items.map((i) => i.location ?? []))),
              folderName: album.name,
            }}
          />
        )
      )}
      <p className="text-xs text-subtle">The link is a copy of the album as it is now: photos added later aren&apos;t in it.</p>
      <AllLinks />
    </section>
  );
}

function RenameForm({ album, onDone }: { album: Props["album"]; onDone: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(album.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await renameAlbumAction(album.id, name);
          if (res.error) setError(res.error);
          else {
            onDone();
            router.refresh();
          }
        });
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        required
        autoFocus
        maxLength={MAX_ALBUM_NAME}
        pattern=".*\S.*"
        title="Give the album a name."
        aria-label="Album name"
        className={field}
      />
      {error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          disabled={pending}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
        </button>
      </div>
    </form>
  );
}
