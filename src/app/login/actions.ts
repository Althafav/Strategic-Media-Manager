"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";

export type LoginState = { error?: string; email?: string };

/** Only same-site relative paths, so `?next=` can't be used as an open redirect. */
function safeNext(value: FormDataEntryValue | null) {
  const next = String(value ?? "");
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  if (!checkCredentials(email, password)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return { error: "Email or password is incorrect.", email };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
