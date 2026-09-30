"use client";

import { useActionState, useRef } from "react";
import Link from "next/link";
import { ImagePlus, Loader2, Send } from "lucide-react";
import { createRequestAction, type CreateRequestState } from "@/app/requests/actions";
import { MAX_REQUEST_LENGTH } from "@/lib/request-types";
import { ShareDialog } from "./share-folder-button";

type Props = {
  event: string;
  folderPath: string[];
  folderName: string;
  /** Display name of the event's coordinator. */
  coordinator: string;
};

export function RequestPhotosButton({ event, folderPath, folderName, coordinator }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState<CreateRequestState, FormData>(createRequestAction, {});

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="h-9 px-3 rounded-md border border-border bg-surface text-sm font-medium inline-flex items-center gap-2 hover:border-foreground"
      >
        <ImagePlus className="size-4" /> Request photos
      </button>

      <ShareDialog
        ref={dialog}
        title="Request photos"
        description={`Your request goes to ${coordinator}, the marketing coordinator for this event. You can follow it under Requests.`}
      >
        {/* key: clear the message after each request is sent */}
        <form key={state.sent} action={action} className="space-y-3">
          <input type="hidden" name="event" value={event} />
          <input type="hidden" name="folderPath" value={JSON.stringify(folderPath)} />
          <label className="block">
            <span className="text-sm font-medium">What do you need?</span>
            <textarea
              name="message"
              required
              rows={5}
              maxLength={MAX_REQUEST_LENGTH}
              defaultValue={state.values?.message}
              placeholder={`e.g. Five landscape photos of the keynote in “${folderName}” for LinkedIn, by Thursday.`}
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
              disabled={pending}
              className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Send request
            </button>
          </div>
        </form>
      </ShareDialog>
    </>
  );
}
