import { db } from "@/lib/db";

/** Team members allowed to sign in with Microsoft SSO (table app_users, migration 0007). Server-only. */
export type UserRow = {
  email: string;
  name: string | null;
  added_at: string;
  last_login_at: string | null;
  /** Migration 0009. Absent until it runs, which means active. */
  status?: "active" | "pending";
  requested_at?: string | null;
};

const MAX_PENDING = 100; // the broker's ?email= is unsigned, so bound how many requests strangers can create

export const isPending = (u: UserRow) => u.status === "pending";

let cached: { at: number; rows: UserRow[] } | null = null;
const TTL_MS = 30_000; // also how long a removed user can keep browsing (proxy.ts checks this list)

export async function listUsers(): Promise<UserRow[]> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const { data, error } = await db().from("app_users").select("*").order("added_at", { ascending: false });
    if (error) throw error;
    cached = { at: Date.now(), rows: data as UserRow[] };
  }
  return cached.rows;
}

export async function isAllowedUser(email: string | undefined): Promise<boolean> {
  const e = normalizeEmail(email ?? "");
  return e !== "" && (await listUsers()).some((u) => u.email === e && !isPending(u));
}

/** Records a sign-in attempt from an unknown email. Returns the resulting status, or null if it couldn't be stored. */
export async function requestAccess(email: string): Promise<"active" | "pending" | null> {
  const e = normalizeEmail(email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254) return null;
  const rows = await listUsers();
  const existing = rows.find((u) => u.email === e);
  if (existing) return isPending(existing) ? "pending" : "active";
  if (rows.filter(isPending).length >= MAX_PENDING) return null;

  const { error } = await db().from("app_users").insert({ email: e, status: "pending", requested_at: new Date().toISOString() });
  cached = null;
  if (error && error.code !== "23505") return null;
  return "pending";
}

export async function approveUser(email: string): Promise<void> {
  const { error } = await db()
    .from("app_users")
    .update({ status: "active", added_at: new Date().toISOString() })
    .eq("email", normalizeEmail(email));
  cached = null;
  if (error) throw error;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export type AddUserResult = { ok: true } | { ok: false; error: string };

export async function addUser(input: { email: string; name?: string }): Promise<AddUserResult> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { ok: false, error: "Enter a valid email address." };
  const name = input.name?.trim().slice(0, 120) || null;

  const { error } = await db().from("app_users").insert({ email, name });
  if (error?.code === "23505") {
    // A pending request for this email: adding it is the same as approving it.
    const { data } = await db().from("app_users").select("status").eq("email", email).maybeSingle();
    if (data?.status === "pending") {
      const { error: upErr } = await db()
        .from("app_users")
        .update({ status: "active", added_at: new Date().toISOString(), ...(name ? { name } : {}) })
        .eq("email", email);
      cached = null;
      return upErr ? { ok: false, error: upErr.message } : { ok: true };
    }
  }
  cached = null;
  if (error?.code === "23505") return { ok: false, error: `${email} is already added.` };
  if (error?.code === "42P01" || /app_users/.test(error?.message ?? "")) {
    return { ok: false, error: "Run supabase/migrations/0007_app_users.sql in the Supabase SQL editor first." };
  }
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function removeUser(email: string): Promise<void> {
  const { error } = await db().from("app_users").delete().eq("email", normalizeEmail(email));
  cached = null;
  if (error) throw error;
}

export async function touchLogin(email: string): Promise<void> {
  await db().from("app_users").update({ last_login_at: new Date().toISOString() }).eq("email", normalizeEmail(email));
  cached = null;
}
