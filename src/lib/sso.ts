import { headers } from "next/headers";

/**
 * Microsoft SSO through the AIM Congress broker (sso-authenticate.aimcongress.com).
 * The broker signs the user in with Entra ID, then redirects to RedirectUrl with the email appended,
 * so RedirectUrl must end in "?email=". Its firewall rejects localhost redirects: test on a deployed URL.
 *
 * The returned email is NOT signed (accepted trade-off). What limits abuse: only emails the admin added
 * on /users (app_users, lib/users.ts) get in, and a short-lived state cookie set by /api/auth/sso,
 * so a crafted /sso-login link does nothing unless that browser just started a login itself.
 */
const DEFAULT_LOGIN_URL = "https://sso-authenticate.aimcongress.com/Account/Login";

export const SSO_STATE_COOKIE = "smm_sso";
export const SSO_STATE_MAX_AGE = 60 * 10; // seconds to complete the Microsoft sign-in

export async function appBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function ssoLoginUrl(): Promise<string> {
  const redirect = `${await appBaseUrl()}/sso-login?email=`;
  return `${process.env.SSO_LOGIN_URL ?? DEFAULT_LOGIN_URL}?RedirectUrl=${encodeURIComponent(redirect)}`;
}
