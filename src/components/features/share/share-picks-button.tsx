"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2 } from "lucide-react";
import type { MediaItem } from "@/lib/onedrive/types";
import { MAX_PICK_ITEMS, picksHref } from "@/lib/share-types";

const STYLE = {
  // On the ink selection bar, like its other secondary actions.
  bar: "h-9 px-3 rounded-md border border-white/25 text-sm font-medium inline-flex items-center gap-2 hover:bg-white/10 disabled:opacity-60",
  // In the lightbox toolbar, next to Download.
  lightbox: "h-9 px-2.5 sm:px-3 rounded-md bg-white/10 hover:bg-white/20 text-sm inline-flex items-center gap-2",
};

const COPIED_MS = 2500;

/**
 * Share-link visitors: a link to just the selected files (or the open photo), built from the signatures the
 * page already issued (`picksHref`), so nothing is stored. Phones get the system share sheet; elsewhere the
 * link is copied. Renders nothing on team pages, whose items carry no `t`/`sig`.
 */
export function SharePicksButton({ items, variant = "bar" }: { items: MediaItem[]; variant?: keyof typeof STYLE }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const files = items.filter((i) => i.kind === "file" && i.t && i.sig);
  if (!files.length) return null;
  const tooMany = files.length > MAX_PICK_ITEMS;
  const what = files.length === 1 ? (files[0].isImage ? "this photo" : "this file") : `these ${files.length} files`;
  const title = tooMany
    ? `A link can carry up to ${MAX_PICK_ITEMS} files. Select fewer, or download them instead.`
    : `Copy a link to ${what}${files.length < items.length ? " (folders are left out)" : ""}`;

  const share = async () => {
    const url = location.origin + picksHref(files[0].t!, files.map((f) => ({ id: f.id, sig: f.sig! })));
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ url });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return; // they closed the sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // Clipboard blocked: show the link so it can be copied by hand.
      window.prompt("Copy this link", url);
    }
  };

  return (
    <button type="button" onClick={share} disabled={tooMany} title={title} className={STYLE[variant]}>
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />}
      <span aria-live="polite" className={variant === "lightbox" ? "sr-only sm:not-sr-only" : undefined}>
        {copied ? "Link copied" : "Copy link"}
      </span>
    </button>
  );
}
