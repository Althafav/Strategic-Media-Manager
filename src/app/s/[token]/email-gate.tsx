"use client";

import { useActionState } from "react";
import { Loader2, Mail } from "lucide-react";
import { submitShareEmail, type GateState } from "./actions";

const input =
  "w-full h-10 rounded-md bg-background border border-border px-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

/** Shown instead of a share link's content until the visitor enters their name and email. */
export function EmailGate({ token, back }: { token: string; back: string }) {
  const [state, action, pending] = useActionState<GateState, FormData>(submitShareEmail, {});

  return (
    <div className="py-20 max-w-sm mx-auto">
      <div className="rounded-lg border border-border bg-surface p-6">
        <Mail className="size-8 text-subtle" />
        <h1 className="display text-3xl mt-3">Enter your details to view these files</h1>

        <form action={action} className="space-y-4 mt-5">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="back" value={back} />
          <label className="block">
            <span className="text-sm font-medium">Full name</span>
            <input
              name="name"
              required
              autoFocus
              autoComplete="name"
              minLength={2}
              maxLength={120}
              defaultValue={state.name}
              className={`${input} mt-1.5`}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              maxLength={254}
              defaultValue={state.email}
              className={`${input} mt-1.5`}
            />
          </label>

          {state.error && (
            <p role="alert" className="text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
              {state.error}
            </p>
          )}

          <button
            disabled={pending}
            className="w-full h-10 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" />}
            {pending ? "Opening…" : "View files"}
          </button>
        </form>
      </div>
    </div>
  );
}
