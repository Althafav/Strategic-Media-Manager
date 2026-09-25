import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { isAllowedUser } from "@/lib/users";

/**
 * Session in a signed, httpOnly cookie: the admin (AUTH_EMAIL / AUTH_PASSWORD) or an SSO team member.
 * The signing key includes the password, so changing AUTH_PASSWORD or AUTH_SECRET logs everyone out.
 */
export const SESSION_COOKIE = "smm_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days, in seconds

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_MAX_AGE,
} as const;

/** Only same-site relative paths, so `?next=` can't be used as an open redirect. */
export function safeNext(value: unknown): string {
  const next = String(value ?? "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function signingKey() {
  const secret = process.env.AUTH_SECRET;
  const password = process.env.AUTH_PASSWORD;
  return secret && password ? `${secret}:${password}` : null;
}

function sign(payload: string, key: string) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function checkCredentials(email: string, password: string): boolean {
  const expectedEmail = process.env.AUTH_EMAIL;
  const expectedPassword = process.env.AUTH_PASSWORD;
  if (!expectedEmail || !expectedPassword || !signingKey()) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const passwordOk = safeEqual(password, expectedPassword);
  return emailOk && passwordOk;
}

/**
 * admin: the email/password login (AUTH_EMAIL / AUTH_PASSWORD). Manages users and events.
 * user: a team member who signed in with Microsoft SSO; `email` must stay in app_users (checked in proxy.ts).
 */
export type Role = "admin" | "user";
export type Session = { role: Role; email?: string };

export function createSessionToken(session: Session): string {
  const key = signingKey();
  if (!key) throw new Error("AUTH_SECRET and AUTH_PASSWORD must be set.");
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE * 1000, ...session })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function verifySessionToken(token: string | undefined): Session | null {
  const key = signingKey();
  if (!key || !token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, key))) return null;
  try {
    const { exp, role, email } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof exp !== "number" || exp <= Date.now()) return null;
    const mail = typeof email === "string" && email ? email : undefined;
    // Tokens from before roles existed: SSO ones carry an email, password ones don't.
    const r: Role = role === "admin" || role === "user" ? role : mail ? "user" : "admin";
    if (r === "user" && !mail) return null;
    return { role: r, email: mail };
  } catch {
    return null;
  }
}

/** Signature + expiry, plus: an SSO user removed from app_users loses access (within the users cache TTL). */
export async function verifyActiveSession(token: string | undefined): Promise<Session | null> {
  const session = verifySessionToken(token);
  if (session?.role !== "user") return session;
  return (await isAllowedUser(session.email).catch(() => false)) ? session : null; // fail closed
}

export async function getSession(): Promise<Session | null> {
  return verifyActiveSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function isAdmin(): Promise<boolean> {
  return (await getSession())?.role === "admin";
}

/** For server actions: returns an error message when not logged in, null otherwise. */
export async function requireSession(): Promise<string | null> {
  return (await getSession()) ? null : "Your session has expired. Log in again.";
}

/** For admin-only server actions: returns an error message unless the admin is logged in. */
export async function requireAdmin(): Promise<string | null> {
  const session = await getSession();
  if (!session) return "Your session has expired. Log in again.";
  return session.role === "admin" ? null : "Only the admin can do this.";
}
