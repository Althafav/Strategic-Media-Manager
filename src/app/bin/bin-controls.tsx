"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Trash2 } from "lucide-react";
import {
  emptyBinAction,
  purgeRequestAction,
  purgeShareAction,
  restoreRequestAction,
  restoreShareAction,
} from "./actions";

type Kind = "share" | "request";
const NOUN: Record<Kind, string> = { share: "link", request: "request" };

/** Runs a bin action and refreshes the page; errors show in an alert, like the users page. */
function useBinAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: () => Promise<{ error?: string }>) =>
    start(async () => {
      const res = await action();
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  return [pending, run] as const;
}

export function BinItemControls({ kind, id }: { kind: Kind; id: string }) {
  const [restoring, runRestore] = useBinAction();
  const [purging, runPurge] = useBinAction();
  const busy = restoring || purging;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => runRestore(() => (kind === "share" ? restoreShareAction(id) : restoreRequestAction(id)))}
        className="h-8 px-3 rounded-md border border-border text-sm inline-flex items-center gap-1.5 hover:bg-muted disabled:opacity-60"
      >
        {restoring ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        Restore
      </button>
      <button
        type="button"
        disabled={busy}
        title="Delete forever"
        aria-label={`Delete this ${NOUN[kind]} forever`}
        onClick={() => {
          if (!window.confirm(`Delete this ${NOUN[kind]} for good? This can't be undone.`)) return;
          runPurge(() => (kind === "share" ? purgeShareAction(id) : purgeRequestAction(id)));
        }}
        className="size-8 rounded-md border border-border grid place-items-center text-subtle hover:text-red-600 hover:border-red-500/40 disabled:opacity-60"
      >
        {purging ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
      </button>
    </div>
  );
}

export function EmptyBinButton({ count }: { count: number }) {
  const [pending, run] = useBinAction();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(`Delete all ${count} ${count === 1 ? "item" : "items"} in the bin for good? This can't be undone.`)) return;
        run(emptyBinAction);
      }}
      className="h-9 px-3 rounded-md bg-red-600 text-white text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />} Empty bin
    </button>
  );
}
