import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

/**
 * One shared team login (AUTH_EMAIL / AUTH_PASSWORD), kept in a signed, httpOnly cookie.
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

/** `email` is set for Microsoft SSO logins; the shared password login has none. */
export function createSessionToken(email?: string): string {
  const key = signingKey();
  if (!key) throw new Error("AUTH_SECRET and AUTH_PASSWORD must be set.");
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_MAX_AGE * 1000, email })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  const key = signingKey();
  if (!key || !token) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload, key))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

export async function getSession(): Promise<boolean> {
  return verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For server actions: returns an error message when not logged in, null otherwise. */
export async function requireSession(): Promise<string | null> {
  return (await getSession()) ? null : "Your session has expired. Log in again.";
}
