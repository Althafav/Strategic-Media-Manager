"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronUp, GripVertical, Loader2 } from "lucide-react";
import { reorderEventsAction } from "@/app/events/actions";

type Item = { slug: string; title: string };

/** Admin: drag rows (or use the arrows) to set the order events are listed in. Saves on drop. */
export function EventOrderList({ events }: { events: Item[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(events);
  const [dragging, setDragging] = useState<string>();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string>();
  // Order when the drag started, so a drop in the same place doesn't save.
  const before = useRef<string>("");

  const save = (next: Item[]) =>
    startSave(async () => {
      const res = await reorderEventsAction(next.map((e) => e.slug));
      setError(res.error);
      if (res.error) setOrder(events);
      else router.refresh();
    });

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return order;
    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder(next);
    return next;
  };

  const endDrag = () => {
    setDragging(undefined);
    if (order.map((e) => e.slug).join("\n") !== before.current) save(order);
  };

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {order.map((e, i) => (
          <li
            key={e.slug}
            draggable={!saving}
            onDragStart={(ev) => {
              before.current = order.map((o) => o.slug).join("\n");
              ev.dataTransfer.effectAllowed = "move";
              ev.dataTransfer.setData("text/plain", e.slug);
              setDragging(e.slug);
            }}
            onDragOver={(ev) => {
              if (!dragging) return;
              ev.preventDefault();
              if (dragging !== e.slug) move(order.findIndex((o) => o.slug === dragging), i);
            }}
            onDrop={(ev) => ev.preventDefault()}
            onDragEnd={endDrag}
            className={`flex items-center gap-2 px-2 py-1.5 ${saving ? "" : "cursor-grab active:cursor-grabbing"} ${
              dragging === e.slug ? "opacity-50" : ""
            }`}
          >
            <GripVertical className="size-4 text-subtle shrink-0" aria-hidden />
            <span className="w-6 text-sm text-subtle tabular-nums text-right shrink-0">{i + 1}</span>
            <span className="flex-1 min-w-0 truncate text-sm">{e.title}</span>
            <button
              type="button"
              aria-label={`Move ${e.title} up`}
              disabled={saving || i === 0}
              onClick={() => save(move(i, i - 1))}
              className="size-8 rounded-md inline-flex items-center justify-center hover:bg-background disabled:opacity-30"
            >
              <ChevronUp className="size-4" />
            </button>
            <button
              type="button"
              aria-label={`Move ${e.title} down`}
              disabled={saving || i === order.length - 1}
              onClick={() => save(move(i, i + 1))}
              className="size-8 rounded-md inline-flex items-center justify-center hover:bg-background disabled:opacity-30"
            >
              <ChevronDown className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-subtle inline-flex items-center gap-2" aria-live="polite">
        {saving ? (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Saving order…
          </>
        ) : (
          "Drag an event to move it. The order is saved straight away."
        )}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
          {error}
        </p>
      )}
    </>
  );
}
