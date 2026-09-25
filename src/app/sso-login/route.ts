import { type NextRequest, NextResponse } from "next/server";
import { createSessionToken, safeNext, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";
import { isAllowedSsoEmail, SSO_STATE_COOKIE } from "@/lib/sso";

/** Broker callback: /sso-login?email=<address>. See lib/sso.ts for what is (and isn't) verified. */
export async function GET(request: NextRequest) {
  const email = (request.nextUrl.searchParams.get("email") ?? "").trim().toLowerCase();
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
  if (!isAllowedSsoEmail(email)) return fail("sso_denied");

  const res = NextResponse.redirect(new URL(next, request.url));
  res.cookies.delete(SSO_STATE_COOKIE); // one login per start
  res.cookies.set(SESSION_COOKIE, createSessionToken(email), SESSION_COOKIE_OPTIONS);
  return res;
}
