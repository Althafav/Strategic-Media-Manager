import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Email gate for share links (migration 0014). A visitor must enter an email before `/s/<token>` shows anything;
 * the action stores it in `share_emails` and sets a signed cookie for that token. The page and the media APIs
 * (`lib/access.ts`, `/api/manifest`) both require that cookie or a team session. Server-only.
 */
export type ShareEmailRow = {
  id: number;
  share_id: string | null;
  share_token: string;
  share_label: string | null;
  event_id: string | null;
  email: string;
  /** Full name from the gate (migration 0017). Null for rows from before it. */
  name?: string | null;
  first_seen_at: string;
  last_seen_at: string;
  visit_count: number;
};

const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days: returning visitors aren't asked again
/** Most distinct emails one link stores, so a script can't fill the table through one link. */
const MAX_EMAILS_PER_SHARE = 2000;

export const gateCookieName = (token: string) => `smm_gate_${token}`;

function gateValue(token: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to use share links.");
  return createHmac("sha256", secret).update(`gate:${token}`).digest("base64url");
}

/** Path `/` so the media API requests made from the share page carry it too. */
export async function setGateCookie(token: string) {
  (await cookies()).set(gateCookieName(token), gateValue(token), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GATE_MAX_AGE,
  });
}

async function hasPassedGate(token: string): Promise<boolean> {
  const value = (await cookies()).get(gateCookieName(token))?.value;
  if (!value) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(gateValue(token));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** May this request see the share's content: a team member, or a visitor who entered an email for this link. */
export async function canViewShare(token: string): Promise<boolean> {
  return (await getSession()) !== null || (await hasPassedGate(token));
}

/** Returns false when the link is gone or has reached its email cap. Throws before migration 0014. */
export async function recordShareEmail(token: string, email: string, name: string): Promise<boolean> {
  let { data, error } = await db().rpc("record_share_email", { tok: token, mail: email, full_name: name, cap: MAX_EMAILS_PER_SHARE });
  if (error?.code === "PGRST202") {
    // Migration 0017 hasn't run: the function has no name parameter yet. Keep the gate working without it.
    ({ data, error } = await db().rpc("record_share_email", { tok: token, mail: email, cap: MAX_EMAILS_PER_SHARE }));
  }
  if (error) throw error;
  return data === true;
}

const PAGE = 1000; // Supabase's default max rows per request

/** Newest first, every row (paged). `shareToken` limits it to one link. */
export async function listShareEmails(filter: { shareToken?: string } = {}): Promise<ShareEmailRow[]> {
  const rows: ShareEmailRow[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = db()
      .from("share_emails")
      .select("*")
      .order("last_seen_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + PAGE - 1);
    if (filter.shareToken) query = query.eq("share_token", filter.shareToken);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data as ShareEmailRow[]));
    if (data.length < PAGE) return rows;
  }
}
