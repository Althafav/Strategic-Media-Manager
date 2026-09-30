"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { MAX_REQUEST_LENGTH, REQUEST_STATUSES, STATUS_LABEL, type RequestStatus } from "@/lib/request-types";
import { updateRequestAction } from "./actions";

const field =
  "rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** The coordinator's answer to one request: a status and an optional note the requester sees. */
export function RequestControls({ id, status, note }: { id: string; status: RequestStatus; note: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nextStatus, setNextStatus] = useState<RequestStatus>(status);
  const [nextNote, setNextNote] = useState(note ?? "");
  const changed = nextStatus !== status || nextNote.trim() !== (note ?? "");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateRequestAction(id, nextStatus, nextNote);
          if (res.error) window.alert(res.error);
          router.refresh();
        });
      }}
      className="grid gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-start"
    >
      <select
        aria-label="Status"
        value={nextStatus}
        onChange={(e) => setNextStatus(e.currentTarget.value as RequestStatus)}
        className={`${field} h-9`}
      >
        {REQUEST_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
      <textarea
        aria-label="Note to the requester"
        rows={1}
        maxLength={MAX_REQUEST_LENGTH}
        value={nextNote}
        onChange={(e) => setNextNote(e.currentTarget.value)}
        placeholder="Note to the requester (optional), e.g. where to find the photos"
        className={`${field} py-2 min-h-9 field-sizing-content`}
      />
      <button
        disabled={pending || !changed}
        className="h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Save
      </button>
    </form>
  );
}
