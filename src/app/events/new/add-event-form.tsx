"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { addEvent, type AddEventState } from "../actions";

const input =
  "w-full h-10 rounded-md bg-surface border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function AddEventForm() {
  const [state, action, pending] = useActionState<AddEventState, FormData>(addEvent, {});

  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="text-sm font-medium">Event name</span>
        <input
          name="title"
          required
          maxLength={120}
          defaultValue={state.values?.title}
          placeholder="AIM Congress 2026"
          className={`${input} mt-1.5`}
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium">Storage URL</span>
        <input
          name="shareUrl"
          type="url"
          required
          defaultValue={state.values?.shareUrl}
          placeholder="https://…sharepoint.com/:f:/g/personal/…"
          className={`${input} mt-1.5 font-mono text-xs`}
        />
        <span className="block text-xs text-subtle mt-1.5">
          In OneDrive, select the event folder → <strong>Share</strong> → <strong>Anyone with the link</strong> (view
          only) → <strong>Copy link</strong>.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium">Admin key</span>
        <input name="adminKey" type="password" required autoComplete="off" className={`${input} mt-1.5`} />
      </label>

      {state.error && (
        <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
          {state.error}
        </p>
      )}

      <button
        disabled={pending}
        className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "Checking link…" : "Add event"}
      </button>
    </form>
  );
}
