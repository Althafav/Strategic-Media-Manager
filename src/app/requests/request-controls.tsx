"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleSlash, Loader2, Play, RotateCcw, Save, Trash2 } from "lucide-react";
import { isOpen, MAX_REQUEST_LENGTH, type RequestStatus } from "@/lib/request-types";
import { deleteRequestAction, updateRequestAction } from "./actions";

type Action = { status: RequestStatus; label: string; icon: typeof Check; primary?: boolean; confirm?: string };

/** What the coordinator can do next. Every button saves at once (with the note), so nothing is lost by forgetting "Save". */
function actionsFor(status: RequestStatus): Action[] {
  const fulfil: Action = { status: "fulfilled", label: "Mark fulfilled", icon: Check, primary: true };
  const decline: Action = { status: "declined", label: "Decline", icon: CircleSlash, confirm: "Decline this request?" };
  if (status === "pending") return [{ status: "in_progress", label: "Start", icon: Play }, fulfil, decline];
  if (status === "in_progress") return [fulfil, decline];
  return [{ status: "pending", label: "Reopen", icon: RotateCcw }];
}

const button = "h-9 px-3 rounded-md text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50";

/** Deletes an answered request for everyone. `leaveTo`: where to go afterwards (its own page no longer exists). */
export function DeleteRequestButton({ id, leaveTo, compact }: { id: string; leaveTo?: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="Delete request"
      aria-label="Delete request"
      onClick={() => {
        if (!window.confirm("Delete this request? It will be removed for the requester and the coordinator.")) return;
        start(async () => {
          const res = await deleteRequestAction(id);
          if (res.error) window.alert(res.error);
          else if (leaveTo) router.push(leaveTo);
          router.refresh();
        });
      }}
      className={`${compact ? "size-8" : "size-9"} shrink-0 rounded-md border border-border bg-surface grid place-items-center text-subtle hover:text-red-600 hover:border-red-500/40 disabled:opacity-60`}
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}

/** The coordinator's answer to one request: a note the requester sees, and the next status. */
export function RequestControls({
  id,
  status,
  note,
  leaveTo,
}: {
  id: string;
  status: RequestStatus;
  note: string | null;
  /** Where to go after deleting (set on the request's own page). */
  leaveTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<RequestStatus | null>(null);
  const [nextNote, setNextNote] = useState(note ?? "");
  const noteChanged = nextNote.trim() !== (note ?? "");

  const save = (next: RequestStatus, confirm?: string) => {
    if (confirm && !window.confirm(confirm)) return;
    setBusy(next);
    start(async () => {
      const res = await updateRequestAction(id, next, nextNote);
      if (res.error) window.alert(res.error);
      setBusy(null);
      router.refresh();
    });
  };

  return (
    <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start">
      <textarea
        aria-label="Note to the requester"
        rows={1}
        maxLength={MAX_REQUEST_LENGTH}
        value={nextNote}
        onChange={(e) => setNextNote(e.currentTarget.value)}
        placeholder="Note to the requester (optional), e.g. where to find the photos"
        className="rounded-md bg-background border border-border px-3 py-2 text-sm min-h-9 field-sizing-content outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
      />
      <div className="flex flex-wrap gap-2">
        {actionsFor(status).map(({ status: next, label, icon: Icon, primary, confirm }) => (
          <button
            key={next}
            type="button"
            disabled={pending}
            onClick={() => save(next, confirm)}
            className={`${button} ${primary ? "bg-accent text-accent-foreground" : "border border-border bg-surface hover:border-foreground"}`}
          >
            {busy === next ? <Loader2 className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />} {label}
          </button>
        ))}
        {/* Answered requests: the note can still be corrected without changing the status. */}
        {!isOpen(status) && noteChanged && (
          <button
            type="button"
            disabled={pending}
            onClick={() => save(status)}
            className={`${button} bg-accent text-accent-foreground`}
          >
            {busy === status ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Update note
          </button>
        )}
        {!isOpen(status) && <DeleteRequestButton id={id} leaveTo={leaveTo} />}
      </div>
    </div>
  );
}
