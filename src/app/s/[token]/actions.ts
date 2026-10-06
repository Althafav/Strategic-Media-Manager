"use server";

import { redirect } from "next/navigation";
import { recordShareEmail, setGateCookie } from "@/lib/share-emails";
import { getActiveShare } from "@/lib/shares";
import { isValidEmail, normalizeEmail } from "@/lib/users";

export type GateState = { error?: string; email?: string; name?: string };

/** The share-link email gate: stores the visitor's name and email, then lets them in for 30 days. Public (no session). */
export async function submitShareEmail(_prev: GateState, form: FormData): Promise<GateState> {
  const token = String(form.get("token") ?? "");
  const raw = String(form.get("email") ?? "");
  const email = normalizeEmail(raw);
  const rawName = String(form.get("name") ?? "");
  const name = rawName.trim().replace(/\s+/g, " ");
  const fail = (error: string): GateState => ({ error, email: raw, name: rawName });

  if (!(await getActiveShare(token).catch(() => null))) return fail("This link has expired or was removed.");
  if (name.length < 2 || name.length > 120) return fail("Enter your full name.");
  if (!isValidEmail(email)) return fail("Enter a valid email address.");

  const stored = await recordShareEmail(token, email, name).catch(() => null);
  if (stored === null) return fail("Something went wrong. Try again in a moment.");
  if (!stored) return fail("This link can't take any more visitors. Ask the person who shared it for a new link.");

  await setGateCookie(token);
  // Back to the page they opened, but only somewhere inside this link.
  const back = String(form.get("back") ?? "");
  redirect(back.startsWith(`/s/${token}/`) || back === `/s/${token}` ? back : `/s/${token}`);
}
