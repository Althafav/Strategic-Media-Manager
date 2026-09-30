"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserRound } from "lucide-react";
import { setEventCoordinator } from "@/app/events/actions";

type Props = {
  slug: string;
  current: string | null;
  /** Active users the admin can pick from. */
  users: { email: string; label: string }[];
};

/** Admin only: the event's marketing coordinator (one per event), who receives its photo requests. */
export function CoordinatorSelect({ slug, current, users }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="h-9 pl-3 pr-1 rounded-md border border-border bg-surface text-sm inline-flex items-center gap-2" title="Marketing coordinator: receives photo requests for this event">
      {pending ? <Loader2 className="size-4 animate-spin text-subtle" /> : <UserRound className="size-4 text-subtle" />}
      <span className="text-subtle hidden sm:inline">Coordinator</span>
      <select
        aria-label="Marketing coordinator"
        value={current ?? ""}
        disabled={pending}
        onChange={(e) => {
          const email = e.currentTarget.value;
          start(async () => {
            const res = await setEventCoordinator(slug, email);
            if (res.error) window.alert(res.error);
            router.refresh();
          });
        }}
        className="h-7 max-w-48 rounded bg-background border border-transparent px-1 text-sm font-medium outline-none focus:border-foreground"
      >
        <option value="">None</option>
        {current && !users.some((u) => u.email === current) && <option value={current}>{current}</option>}
        {users.map((u) => (
          <option key={u.email} value={u.email}>
            {u.label}
          </option>
        ))}
      </select>
    </label>
  );
}
