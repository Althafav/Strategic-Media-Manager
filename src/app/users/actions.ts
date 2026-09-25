"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { addUser, removeUser } from "@/lib/users";

export type AddUserState = { error?: string; added?: string; values?: { email: string; name: string } };

export async function addUserAction(_prev: AddUserState, form: FormData): Promise<AddUserState> {
  const email = String(form.get("email") ?? "");
  const name = String(form.get("name") ?? "");
  const denied = await requireAdmin();
  if (denied) return { error: denied, values: { email, name } };

  const result = await addUser({ email, name });
  if (!result.ok) return { error: result.error, values: { email, name } };
  revalidatePath("/users");
  return { added: email.trim().toLowerCase() };
}

export async function removeUserAction(email: string): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  try {
    await removeUser(email);
    revalidatePath("/users");
    return {};
  } catch (e) {
    return { error: (e as Error).message || "Could not remove the user." };
  }
}
