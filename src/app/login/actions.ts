"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkCredentials, createSessionToken, safeNext, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@/lib/auth";

export type LoginState = { error?: string; email?: string };

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  if (!checkCredentials(email, password)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return { error: "Email or password is incorrect.", email };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken({ role: "admin" }), SESSION_COOKIE_OPTIONS);
  redirect(safeNext(form.get("next")));
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
