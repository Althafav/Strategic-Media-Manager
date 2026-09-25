"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { removeEvent, type RemoveEventState } from "@/app/events/actions";

export function RemoveEventButton({ slug, title, className = "" }: { slug: string; title: string; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<RemoveEventState, FormData>(removeEvent, {});

  // Keep the dialog open to show errors (also after a no-JS full-page submit).
  useEffect(() => {
    if (state.error && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={`Remove ${title}`}
        title="Remove event"
        className={`size-9 rounded-md bg-foreground/80 text-white grid place-items-center hover:bg-red-700 transition-colors ${className}`}
      >
        <Trash2 className="size-4" />
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="remove-event-title"
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border border-border bg-surface text-foreground p-0 backdrop:bg-black/50"
      >
        <form action={action} className="p-5 space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <div>
            <h2 id="remove-event-title" className="display text-2xl">
              Remove “{title}”?
            </h2>
            <p className="text-sm text-subtle mt-1">
              The event disappears from the app and search. The photos and videos stay in OneDrive. You can add the
              event again later with the same link.
            </p>
          </div>
          {state.error && (
            <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
              {state.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="h-9 px-3 rounded-md border border-border text-sm hover:bg-muted"
            >
              Cancel
            </button>
            <button
              disabled={pending}
              className="h-9 px-3 rounded-md bg-red-600 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              {pending && <Loader2 className="size-4 animate-spin" />} Remove
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
