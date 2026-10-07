"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Heart, ImagePlus, Link2, LogOut, Mail, Settings, Trash2, Users, type LucideIcon } from "lucide-react";
import { logout } from "@/app/login/actions";
import { REQUESTS_SEEN_EVENT, type RequestsSeen } from "@/lib/request-types";

type Props = {
  name: string;
  email?: string;
  isAdmin: boolean;
  /** Requests sent to this coordinator since they last opened the Inbox. */
  newRequests: number;
  /** Answers to this user's own requests they haven't seen yet. */
  newReplies: number;
  pendingCount: number;
};

/**
 * The request counts, minus what pages have reported as seen since the header last rendered. Fresh counts from the
 * server (a reload or a refresh) replace the local adjustments.
 */
function useRequestCount(newRequests: number, newReplies: number) {
  const [cleared, setCleared] = useState({ inbox: false, sent: false, replies: 0 });
  const [counts, setCounts] = useState({ newRequests, newReplies });
  if (counts.newRequests !== newRequests || counts.newReplies !== newReplies) {
    setCounts({ newRequests, newReplies });
    setCleared({ inbox: false, sent: false, replies: 0 });
  }

  useEffect(() => {
    const onSeen = (e: Event) => {
      const seen = (e as CustomEvent<RequestsSeen>).detail ?? {};
      setCleared((c) => ({
        inbox: c.inbox || !!seen.inbox,
        sent: c.sent || !!seen.sent,
        replies: c.replies + (seen.reply ? 1 : 0),
      }));
    };
    window.addEventListener(REQUESTS_SEEN_EVENT, onSeen);
    return () => window.removeEventListener(REQUESTS_SEEN_EVENT, onSeen);
  }, []);

  return (cleared.inbox ? 0 : newRequests) + (cleared.sent ? 0 : Math.max(0, newReplies - cleared.replies));
}

/** First two letters of the display name, e.g. "Althaf" -> "AL". */
function initials(name: string) {
  return (name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2) || "?").toUpperCase();
}

/** Profile circle in the header; opens the app's secondary pages and Log out. */
export function UserMenu({ name, email, isAdmin, newRequests, newReplies, pendingCount }: Props) {
  const requestCount = useRequestCount(newRequests, newReplies);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const badge = requestCount + pendingCount;

  // Close on clicking outside or pressing Escape (picking an item closes it via onClick below).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${name}`}
        title={email ?? name}
        className="relative size-9 rounded-full bg-accent text-accent-foreground text-[13px] font-semibold grid place-items-center hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
      >
        {initials(name)}
        {badge > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-3 rounded-full bg-amber-500 ring-2 ring-surface" aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="menu"
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          className="absolute right-0 top-full mt-2 w-64 rounded-lg border border-border bg-surface shadow-lg py-1.5 z-40"
        >
          <div className="px-3.5 py-2.5 border-b border-border mb-1.5">
            <div className="text-sm font-medium truncate">{name}</div>
            <div className="text-xs text-subtle truncate">{email ?? "Administrator"}</div>
          </div>

          <MenuLink href="/top" icon={Heart} label="Most liked" />
          <MenuLink href="/requests" icon={ImagePlus} label="Requests" count={requestCount} />
          <MenuLink href="/shares" icon={Link2} label="Shared links" />
          {isAdmin && <MenuLink href="/share-emails" icon={Mail} label="Share link emails" />}
          {isAdmin && <MenuLink href="/users" icon={Users} label="Users" count={pendingCount} />}
          {isAdmin && <MenuLink href="/settings" icon={Settings} label="Settings" />}
          {isAdmin && <MenuLink href="/bin" icon={Trash2} label="Recycle bin" />}

          <div className="border-t border-border mt-1.5 pt-1.5">
            <form action={logout}>
              <button role="menuitem" className={itemClass}>
                <LogOut className="size-4 text-subtle" />
                Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

const itemClass =
  "w-full h-9 px-3.5 text-sm text-foreground hover:bg-background inline-flex items-center gap-3 text-left";

function MenuLink({ href, icon: Icon, label, count = 0 }: { href: string; icon: LucideIcon; label: string; count?: number }) {
  return (
    <Link href={href} role="menuitem" className={itemClass}>
      <Icon className="size-4 text-subtle" />
      <span className="flex-1">{label}</span>
      {count > 0 && (
        <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500/20 text-xs text-foreground grid place-items-center">
          {count}
        </span>
      )}
    </Link>
  );
}
