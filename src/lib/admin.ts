import { timingSafeEqual } from "node:crypto";

/**
 * Stand-in for real auth until login is added: a shared admin key.
 * Returns an error message, or null when the key is valid.
 */
export function checkAdminKey(given: FormDataEntryValue | null): string | null {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return "Managing events is disabled: ADMIN_KEY is not configured on the server.";
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? null : "Admin key is incorrect.";
}
