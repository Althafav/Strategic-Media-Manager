"use client";

import { useActionState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { syncEvent, type SyncEventState } from "@/app/events/actions";
import { requestFaceScan } from "@/lib/face-scan-event";

/**
 * "Sync now" for one event's search index. The outcome shows beside the button until the next click.
 * `revealClass` hides it until hover, except while there is an outcome to read.
 */
export function SyncEventButton({ slug, title, revealClass = "" }: { slug: string; title: string; revealClass?: string }) {
  const [state, action, pending] = useActionState<SyncEventState, FormData>(syncEvent, {});
  // A finished sync may have added photos: have the face scanner (admin, in the header) look right away.
  useEffect(() => {
    if (state.message) requestFaceScan();
  }, [state]);
  const note = pending ? "Syncing…" : (state.error ?? state.message);
  return (
    <form action={action} className={`flex items-center gap-2 ${note ? "" : revealClass}`}>
      <input type="hidden" name="slug" value={slug} />
      {note && (
        <p
          role="status"
          className={`max-w-64 rounded-md px-2.5 py-1.5 text-xs shadow-sm ${
            state.error && !pending ? "bg-red-600 text-white" : "bg-foreground/80 text-white"
          }`}
        >
          {note}
        </p>
      )}
      <button
        disabled={pending}
        aria-label={`Sync ${title} now`}
        title="Update search index now"
        className="size-9 shrink-0 rounded-md bg-foreground/80 text-white grid place-items-center hover:bg-foreground transition-colors disabled:cursor-wait"
      >
        <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} />
      </button>
    </form>
  );
}
