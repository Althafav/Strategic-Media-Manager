import { headers } from "next/headers";

/**
 * Microsoft SSO through the AIM Congress broker (sso-authenticate.aimcongress.com).
 * The broker signs the user in with Entra ID, then redirects to RedirectUrl with the email appended,
 * so RedirectUrl must end in "?email=". Its firewall rejects localhost redirects: test on a deployed URL.
 *
 * TEST ONLY: the callback's ?email= is not signed, so it must not create a session until the broker
 * sends something we can verify (signed token or one-time code).
 */
const DEFAULT_LOGIN_URL = "https://sso-authenticate.aimcongress.com/Account/Login";

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

export function allowedSsoEmails(): string[] {
  return (process.env.SSO_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedSsoEmail(email: string): boolean {
  return allowedSsoEmails().includes(email.trim().toLowerCase());
}
