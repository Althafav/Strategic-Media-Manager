"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { renameEventAction, setEventCoordinator } from "@/app/events/actions";
import { EventCoverPicker } from "./event-cover-picker";

type Props = {
  slug: string;
  title: string;
  /** Missing until migration 0011 runs. */
  coordinator?: { current: string | null; users: { email: string; label: string }[] };
  /** The event's root folder; null until the event's link has been opened once. */
  rootId: string | null;
  /** Item id of the cover picked here, if any. */
  coverId?: string;
};

const field =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-60";

/** One event's admin settings: its name (saved on demand), its coordinator (saved on change) and its cover. */
export function EventSettingsRow({ slug, title, coordinator, rootId, coverId }: Props) {
  const router = useRouter();
  const [name, setName] = useState(title);
  const [renaming, startRename] = useTransition();
  const [assigning, startAssign] = useTransition();
  const [error, setError] = useState<string>();
  const dirty = name.trim() !== title && !!name.trim();

  const rename = () =>
    startRename(async () => {
      const res = await renameEventAction(slug, name);
      setError(res.error);
      if (!res.error) router.refresh();
    });

  return (
    <li className="px-4 py-4">
      <div className="grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3 items-end">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) rename();
          }}
          className="flex items-end gap-2"
        >
          <label className="block flex-1 min-w-0">
            <span className="text-sm font-medium">Event name</span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              required
              maxLength={120}
              disabled={renaming}
              className={`${field} mt-1.5`}
            />
          </label>
          <button
            disabled={!dirty || renaming}
            className="h-10 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2 disabled:opacity-40"
          >
            {renaming ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save
          </button>
        </form>

        {coordinator && (
          <label className="block">
            <span className="text-sm font-medium inline-flex items-center gap-2">
              Marketing coordinator {assigning && <Loader2 className="size-3.5 animate-spin text-subtle" />}
            </span>
            <select
              value={coordinator.current ?? ""}
              disabled={assigning}
              onChange={(e) => {
                const email = e.currentTarget.value;
                startAssign(async () => {
                  const res = await setEventCoordinator(slug, email);
                  setError(res.error);
                  router.refresh();
                });
              }}
              className={`${field} mt-1.5`}
            >
              <option value="">None</option>
              {coordinator.current && !coordinator.users.some((u) => u.email === coordinator.current) && (
                <option value={coordinator.current}>{coordinator.current}</option>
              )}
              {coordinator.users.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {rootId && (
        <div className="mt-4">
          <EventCoverPicker slug={slug} title={title} rootId={rootId} current={coverId} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
          {error}
        </p>
      )}
    </li>
  );
}
