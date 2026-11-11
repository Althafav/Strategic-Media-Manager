"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOOSE_DIST, unpackEmbedding } from "@/lib/face-types";
import { matchShareFaces } from "@/lib/face-index";
import { withPreviews } from "@/lib/format";
import { nodeToItem } from "@/lib/nodes";
import type { MediaItem } from "@/lib/onedrive/types";
import { canViewShare, recordShareEmail, setGateCookie } from "@/lib/share-emails";
import { getActiveShare, signItem } from "@/lib/shares";
import { isValidEmail, normalizeEmail } from "@/lib/users";

export type GateState = { error?: string; email?: string; name?: string };

/** The share-link email gate: stores the visitor's name and email, then lets them in for 30 days. Public (no session). */
export async function submitShareEmail(_prev: GateState, form: FormData): Promise<GateState> {
  const token = String(form.get("token") ?? "");
  const raw = String(form.get("email") ?? "");
  const email = normalizeEmail(raw);
  const rawName = String(form.get("name") ?? "");
  const name = rawName.trim().replace(/\s+/g, " ");
  const fail = (error: string): GateState => ({ error, email: raw, name: rawName });

  if (!(await getActiveShare(token).catch(() => null))) return fail("This link has expired or was removed.");
  if (name.length < 2 || name.length > 120) return fail("Enter your full name.");
  if (!isValidEmail(email)) return fail("Enter a valid email address.");

  const stored = await recordShareEmail(token, email, name).catch(() => null);
  if (stored === null) return fail("Something went wrong. Try again in a moment.");
  if (!stored) return fail("This link can't take any more visitors. Ask the person who shared it for a new link.");

  await setGateCookie(token);
  // Back to the page they opened, but only somewhere inside this link.
  const back = String(form.get("back") ?? "");
  redirect(back.startsWith(`/s/${token}/`) || back === `/s/${token}` ? back : `/s/${token}`);
}

/** A matched photo and how close its nearest face was (cosine distance, see MATCH_DIST). */
export type FaceMatch = { item: MediaItem; distance: number };

// Searches per link + IP in a 10-minute window, per server instance: enough for a few retakes, not for
// probing the index with generated faces.
const searches = new Map<string, { at: number; n: number }>();
const SEARCH_WINDOW_MS = 10 * 60_000;
const SEARCH_LIMIT = 20;

async function rateLimited(token: string): Promise<boolean> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${token}:${ip}`;
  const now = Date.now();
  const hit = searches.get(key);
  if (!hit || now - hit.at > SEARCH_WINDOW_MS) {
    if (searches.size > 5000) searches.clear();
    searches.set(key, { at: now, n: 1 });
    return false;
  }
  return ++hit.n > SEARCH_LIMIT;
}

/**
 * "Find my photos": photos in this share with a face like the visitor's. The browser sends only the selfie's
 * face embedding (lib/faces.ts), never the image; it is compared and dropped, not stored. Results are signed
 * like the share page's own items, so they open and download through the usual t/sig checks.
 */
export async function findMyPhotosAction(token: string, embedding: string): Promise<{ matches?: FaceMatch[]; error?: string }> {
  const active = await getActiveShare(token).catch(() => null);
  if (!active) return { error: "This link has expired or was removed." };
  if (!(await canViewShare(token))) return { error: "Enter your name and email first." };
  const { share, event } = active;
  if (!event.face_search) return { error: "Face search isn't available for this link." };
  const v = unpackEmbedding(embedding);
  if (!v) return { error: "That face couldn't be read. Try another photo." };
  if (await rateLimited(token)) return { error: "Too many searches. Try again in a few minutes." };
  try {
    const hits = await matchShareFaces(event, share, v, LOOSE_DIST);
    return {
      // nodeToItem's thumbnail URLs are the team's; withPreviews replaces them with ones carrying t/sig.
      matches: hits.map(({ row, distance }) => ({
        item: withPreviews({ ...nodeToItem(row, event.slug), hasThumb: true, t: token, sig: signItem(token, row.id) }),
        distance,
      })),
    };
  } catch {
    return { error: "Face search isn't working right now. Try again in a moment." };
  }
}
