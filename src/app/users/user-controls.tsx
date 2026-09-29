"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Trash2, UserPlus } from "lucide-react";
import { addUserAction, approveUserAction, removeUserAction, type AddUserState } from "./actions";

const input =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function AddUserForm() {
  const [state, action, pending] = useActionState<AddUserState, FormData>(addUserAction, {});

  return (
    // key: clear the fields after a successful add
    <form key={state.added} action={action} className="rounded-lg border border-border bg-surface p-4 sm:p-5">
      <div className="grid sm:grid-cols-[2fr_1.4fr_auto] gap-3 items-end">
        <label className="block">
          <span className="text-sm font-medium">Microsoft email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="off"
            defaultValue={state.values?.email}
            placeholder="name@strategic.ae"
            className={`${input} mt-1.5`}
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">
            Name <span className="text-subtle font-normal">(optional)</span>
          </span>
          <input name="name" maxLength={120} autoComplete="off" defaultValue={state.values?.name} className={`${input} mt-1.5`} />
        </label>
        <button
          disabled={pending}
          className="h-10 px-4 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
          Add user
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-3 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
          {state.error}
        </p>
      )}
      {state.added && (
        <p role="status" className="mt-3 text-sm text-green-700 dark:text-green-400">
          {state.added} can now sign in with Microsoft.
        </p>
      )}
    </form>
  );
}

export function ApproveUserButton({ email }: { email: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await approveUserAction(email);
          if (res.error) window.alert(res.error);
          router.refresh();
        })
      }
      className="h-8 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      Approve
    </button>
  );
}

export function RemoveUserButton({ email, reject }: { email: string; reject?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title={reject ? "Reject request" : "Remove user"}
      aria-label={`${reject ? "Reject" : "Remove"} ${email}`}
      onClick={() => {
        const msg = reject
          ? `Reject the request from ${email}?`
          : `Remove ${email}? They'll be signed out and can't sign in again.`;
        if (!window.confirm(msg)) return;
        start(async () => {
          const res = await removeUserAction(email);
          if (res.error) window.alert(res.error);
          router.refresh();
        });
      }}
      className="size-8 rounded-md border border-border grid place-items-center text-subtle hover:text-red-600 hover:border-red-500/40 disabled:opacity-60"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}
