"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Send } from "lucide-react";
import { createRequestAction, type CreateRequestState } from "@/app/requests/actions";
import type { MediaItem } from "@/lib/onedrive/types";
import { commonPath, MAX_REQUEST_ITEMS, MAX_REQUEST_LENGTH, type RequestItem } from "@/lib/request-types";
import { setSelection } from "@/lib/selection-store";
import { ShareDialog } from "./share-folder-button";

const sentTo = (coordinator: string) =>
  `Your request goes to ${coordinator}, the marketing coordinator for this event. You can follow it under Requests.`;

/** "Request" in the selection bar: asks the coordinator for exactly the selected photos. */
export function RequestItemsButton(props: { event: string; items: MediaItem[]; folderPath: string[]; coordinator: string }) {
  const { event, items, folderPath, coordinator } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  // Remount the form on every open so it carries the current selection and no stale result.
  const [opened, setOpened] = useState(0);
  const noun = items.length === 1 ? "item" : "items";
  // Each pick remembers its own folder (the selection can span folders); the request is filed under their common parent.
  const picked: RequestItem[] = items.map(({ id, name, kind, location }) => ({ id, name, kind, path: location ?? folderPath }));
  const path = commonPath(picked.map((i) => i.path!));

  let problem: string | null = null;
  // The selection carries across pages, so it may hold items from another event than the one being viewed.
  if (items.some((i) => i.event !== event)) problem = "Some selected items come from another event. Request only items from this event.";
  else if (items.length > MAX_REQUEST_ITEMS) problem = `A request can hold up to ${MAX_REQUEST_ITEMS} items. Select fewer and try again.`;

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
        <ImagePlus className="size-4" /> Request
      </button>
      <ShareDialog ref={dialog} title={`Request ${items.length} ${noun}`} description={sentTo(coordinator)}>
        {problem ? (
          <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">{problem}</p>
        ) : (
          opened > 0 && (
            <RequestForm
              key={opened}
              event={event}
              folderPath={path}
              items={picked}
              placeholder="Optional: what do you need them for? e.g. Edited versions for the press release, by Thursday."
              onSent={() => {
                // Done with these photos: closing the selection bar also closes this dialog.
                dialog.current?.close();
                setSelection(new Map());
              }}
            />
          )
        )}
      </ShareDialog>
    </>
  );
}

function RequestForm(props: {
  event: string;
  folderPath: string[];
  items?: RequestItem[];
  placeholder: string;
  /** Called shortly after a successful send, once the confirmation has been seen. */
  onSent?: () => void;
}) {
  const { event, folderPath, items, placeholder, onSent } = props;
  const [state, action, pending] = useActionState<CreateRequestState, FormData>(createRequestAction, {});
  const withItems = !!items?.length;

  // A ref, so a new callback from a parent re-render doesn't restart the timer.
  const sentRef = useRef(onSent);
  useEffect(() => {
    sentRef.current = onSent;
  });
  useEffect(() => {
    if (!state.sent) return;
    const timer = setTimeout(() => sentRef.current?.(), 1500);
    return () => clearTimeout(timer);
  }, [state.sent]);

  return (
    // key: clear the message after each request is sent
    <form key={state.sent} action={action} className="space-y-3">
      <input type="hidden" name="event" value={event} />
      <input type="hidden" name="folderPath" value={JSON.stringify(folderPath)} />
      {withItems && <input type="hidden" name="items" value={JSON.stringify(items)} />}
      <label className="block">
        <span className="text-sm font-medium">
          {withItems ? "Message" : "What do you need?"}
          {withItems && <span className="text-subtle font-normal"> (optional)</span>}
        </span>
        <textarea
          name="message"
          required={!withItems}
          rows={withItems ? 3 : 5}
          maxLength={MAX_REQUEST_LENGTH}
          defaultValue={state.values?.message}
          placeholder={placeholder}
          className="mt-1.5 w-full rounded-md bg-background border border-border px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 px-3 py-2">
          {state.error}
        </p>
      )}
      {state.sent && (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          Request sent.{" "}
          <Link href="/requests" className="underline underline-offset-4">
            See your requests
          </Link>
        </p>
      )}
      <div className="flex justify-end">
        <button
          disabled={pending || (withItems && !!state.sent)}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send request
        </button>
      </div>
    </form>
  );
}
