"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";
import { revokeShareLink } from "@/app/shares/actions";
import { shareHref } from "@/lib/format";
import { formatDate, isExpired, type ShareRow } from "@/lib/share-types";

export const shareUrl = (token: string) => `${window.location.origin}${shareHref(token)}`;

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CopyLinkButton({ token, label = "Copy" }: { token: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(shareUrl(token))) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } else {
          window.prompt("Copy this link:", shareUrl(token));
        }
      }}
      className="h-8 px-2.5 rounded-md border border-border text-xs font-medium inline-flex items-center gap-1.5 hover:bg-muted"
    >
      {copied ? <Check className="size-3.5 text-green-600" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export function RevokeLinkButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      title="Revoke link"
      aria-label="Revoke link"
      onClick={() => {
        if (!window.confirm("Revoke this link? Anyone using it will lose access immediately.")) return;
        start(async () => {
          const res = await revokeShareLink(id);
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

export function ShareStatus({ share }: { share: ShareRow }) {
  if (isExpired(share)) return <span className="text-red-600 dark:text-red-400">Expired</span>;
  return <span>{share.expires_at ? `Expires ${formatDate(share.expires_at)}` : "Never expires"}</span>;
}
