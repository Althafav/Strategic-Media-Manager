"use server";

import { redirect } from "next/navigation";
import { recordShareEmail, setGateCookie } from "@/lib/share-emails";
import { getActiveShare } from "@/lib/shares";
import { isValidEmail, normalizeEmail } from "@/lib/users";

export type GateState = { error?: string; email?: string };

/** The share-link email gate: stores the visitor's email, then lets them in for 30 days. Public (no session). */
export async function submitShareEmail(_prev: GateState, form: FormData): Promise<GateState> {
  const token = String(form.get("token") ?? "");
  const raw = String(form.get("email") ?? "");
  const email = normalizeEmail(raw);

  if (!(await getActiveShare(token).catch(() => null))) return { error: "This link has expired or was removed.", email: raw };
  if (!isValidEmail(email)) return { error: "Enter a valid email address.", email: raw };

  const stored = await recordShareEmail(token, email).catch(() => null);
  if (stored === null) return { error: "Something went wrong. Try again in a moment.", email: raw };
  if (!stored) return { error: "This link can't take any more visitors. Ask the person who shared it for a new link.", email: raw };

  await setGateCookie(token);
  // Back to the page they opened, but only somewhere inside this link.
  const back = String(form.get("back") ?? "");
  redirect(back.startsWith(`/s/${token}/`) || back === `/s/${token}` ? back : `/s/${token}`);
}
