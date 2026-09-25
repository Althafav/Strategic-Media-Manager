"use client";

import { useActionState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Share2, X } from "lucide-react";
import { createShareLink, type CreateShareState } from "@/app/shares/actions";
import { EXPIRY_OPTIONS, isItemShare, type ShareRow } from "@/lib/share-types";
import { copyText, CopyLinkButton, RevokeLinkButton, shareUrl, ShareStatus } from "./share-link-actions";

type Props = {
  event: string;
  folderId: string;
  folderPath: string[];
  folderName: string;
  /** Existing links for this folder; null when share links aren't set up (migration missing). */
  shares: ShareRow[] | null;
};

const field =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function ShareFolderButton({ event, folderId, folderPath, folderName, shares }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Links to picked items in this folder are listed on /shares, not here.
  const folderShares = shares?.filter((s) => !isItemShare(s)) ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="h-9 px-3 rounded-md border border-border bg-surface text-sm font-medium inline-flex items-center gap-2 hover:border-foreground"
      >
        <Share2 className="size-4" /> Share
      </button>

      <ShareDialog
        ref={dialog}
        title={`Share “${folderName}”`}
        description="Anyone with the link can view and download this folder and its subfolders, without logging in. They can't see anything else."
      >
        {folderShares === null ? (
          <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            Share links aren&apos;t set up yet. Run <code>supabase/migrations/0003_shares.sql</code> in the Supabase SQL
            editor.
          </p>
        ) : (
          <>
            <CreateShareForm fields={{ event, folderId, folderPath: JSON.stringify(folderPath), folderName }} />
            <div>
              <h3 className="text-sm font-medium mb-2">Links to this folder</h3>
              {folderShares.length ? (
                <ul className="divide-y divide-border rounded-md border border-border max-h-64 overflow-auto">
                  {folderShares.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 px-3 py-2">
                      <div className="flex-1 min-w-0 text-xs">
                        <p className="font-medium text-sm truncate">{s.label || "Unnamed link"}</p>
                        <p className="text-subtle">
                          <ShareStatus share={s} />, {s.view_count} {s.view_count === 1 ? "view" : "views"}
                        </p>
                      </div>
                      <CopyLinkButton token={s.token} />
                      <RevokeLinkButton id={s.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-subtle">No links yet.</p>
              )}
              <AllLinks />
            </div>
          </>
        )}
      </ShareDialog>
    </>
  );
}

export function AllLinks() {
  return (
    <Link href="/shares" className="inline-block text-xs text-foreground underline underline-offset-4 mt-2">
      All shared links
    </Link>
  );
}

export function ShareDialog(props: {
  ref: React.Ref<HTMLDialogElement>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { ref, title, description, children } = props;
  const close = (e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.closest("dialog")?.close();
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border border-border bg-surface text-foreground p-0 backdrop:bg-black/50"
    >
      <div className="p-5 space-y-5">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="display text-2xl truncate">{title}</h2>
            <p className="text-sm text-subtle mt-1">{description}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={close}
            className="size-8 rounded-md grid place-items-center text-subtle hover:bg-muted shrink-0"
          >
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Label + expiry form that creates a link from `fields` (hidden inputs) and copies it. */
export function CreateShareForm({ fields }: { fields: Record<string, string> }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<CreateShareState, FormData>(createShareLink, {});

  // New link: copy it straight away and refresh any lists.
  useEffect(() => {
    if (!state.created) return;
    void copyText(shareUrl(state.created.token));
    router.refresh();
  }, [state.created, router]);

  return (
    <>
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <label className="block">
          <span className="text-xs font-medium text-subtle">For (optional)</span>
          <input name="label" maxLength={120} placeholder="e.g. Reuters photo desk" className={`${field} mt-1`} />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-subtle">Expires after</span>
          <select name="expiry" defaultValue="30" className={`${field} mt-1`}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={pending}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />} Create link
        </button>
      </form>

      {state.error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
          {state.error}
        </p>
      )}

      {state.created && (
        <div className="rounded-md border border-green-600/30 bg-green-600/10 p-3 space-y-2">
          <p className="text-sm font-medium">Link created and copied to your clipboard.</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={shareUrl(state.created.token)}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 min-w-0 h-8 rounded-md bg-background border border-border px-2 text-xs font-mono"
            />
            <CopyLinkButton token={state.created.token} />
          </div>
        </div>
      )}
    </>
  );
}
