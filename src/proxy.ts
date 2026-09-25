import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { recordView } from "@/lib/shares";

// /api/sync is called by Vercel Cron and checks its own CRON_SECRET.
// /s/<token> pages are share links; they check the token themselves.
// /api/auth/sso and /sso-login are the Microsoft SSO start and callback (lib/sso.ts).
const PUBLIC_PATHS = ["/login", "/api/sync", "/s", "/api/auth/sso", "/sso-login"];
// Media APIs called from share pages carry ?t=<token>&sig=…, verified in the route (lib/access.ts).
const SHARE_APIS = ["/api/thumb/", "/api/cover/", "/api/download/", "/api/manifest"];

// Session cookie scoped to /s/<token>: a share link's views count once per browser session, not per refresh.
const VIEWED_COOKIE = "smm_viewed";

export function proxy(request: NextRequest, event: NextFetchEvent) {
  const { pathname, search } = request.nextUrl;
  const share = pathname.match(/^\/s\/([A-Za-z0-9_-]{16,64})(?:\/|$)/);
  if (share && !request.cookies.has(VIEWED_COOKIE)) {
    const token = share[1];
    event.waitUntil(recordView(token).catch(() => {}));
    const res = NextResponse.next();
    // No maxAge/expires: the browser drops it when the session ends.
    res.cookies.set(VIEWED_COOKIE, "1", { path: `/s/${token}`, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:" });
    return res;
  }
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (request.nextUrl.searchParams.has("t") && SHARE_APIS.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
