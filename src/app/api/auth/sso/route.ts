import { randomBytes } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { safeNext } from "@/lib/auth";
import { SSO_STATE_COOKIE, SSO_STATE_MAX_AGE, ssoLoginUrl } from "@/lib/sso";

/** "Sign in with Microsoft": remember where to go afterwards, mark this browser as mid-login, go to the broker. */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const res = NextResponse.redirect(await ssoLoginUrl());
  res.cookies.set(SSO_STATE_COOKIE, JSON.stringify({ n: randomBytes(16).toString("base64url"), next }), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax", // sent on the broker's top-level redirect back to /sso-login
    path: "/",
    maxAge: SSO_STATE_MAX_AGE,
  });
  return res;
}
