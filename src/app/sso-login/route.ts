import { after, type NextRequest, NextResponse } from "next/server";
import { createSessionToken, safeNext, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { SSO_STATE_COOKIE } from "@/lib/sso";
import { isAllowedUser, normalizeEmail, requestAccess, touchLogin } from "@/lib/users";

/** Broker callback: /sso-login?email=<address>. See lib/sso.ts for what is (and isn't) verified. */
export async function GET(request: NextRequest) {
  const email = normalizeEmail(request.nextUrl.searchParams.get("email") ?? "");
  let next = "/";
  let started = false;
  try {
    const state = JSON.parse(request.cookies.get(SSO_STATE_COOKIE)?.value ?? "");
    started = typeof state?.n === "string";
    next = safeNext(state?.next);
  } catch {}

  const fail = (error: string) => {
    const login = new URL("/login", request.url);
    login.searchParams.set("error", error);
    const res = NextResponse.redirect(login);
    res.cookies.delete(SSO_STATE_COOKIE);
    return res;
  };

  if (!started) return fail("sso_expired");
  if (!(await isAllowedUser(email).catch(() => false))) {
    // Unknown or pending: record a request for an admin to approve (no session is issued).
    const status = await requestAccess(email).catch(() => null);
    return fail(status === "pending" ? "sso_pending" : "sso_denied");
  }

  after(() => touchLogin(email).catch((e) => console.error("touchLogin failed", e)));
  const res = NextResponse.redirect(new URL(next, request.url));
  res.cookies.delete(SSO_STATE_COOKIE); // one login per start
  res.cookies.set(SESSION_COOKIE, createSessionToken({ role: "user", email }), SESSION_COOKIE_OPTIONS);
  return res;
}
