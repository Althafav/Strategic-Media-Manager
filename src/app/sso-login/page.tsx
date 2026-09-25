import Link from "next/link";
import { isAllowedSsoEmail } from "@/lib/sso";

export const metadata = { title: "SSO result · Strategic Media Manager", robots: { index: false } };

/** Test callback: shows what the SSO broker sent back. Does NOT log in (the email is unsigned, see lib/sso.ts). */
export default async function SsoLoginPage({ searchParams }: PageProps<"/sso-login">) {
  const params = await searchParams;
  const entries = Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, x ?? ""] as const));
  const email = typeof params.email === "string" ? params.email : "";
  const allowed = email !== "" && isAllowedSsoEmail(email);

  return (
    <div className="min-h-[70vh] grid place-items-center py-12">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6 sm:p-8">
        <h1 className="display text-4xl">SSO result</h1>

        {!email ? (
          <p className="mt-4 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
            No email came back.
          </p>
        ) : allowed ? (
          <p className="mt-4 text-sm rounded-md border border-green-600/30 bg-green-600/10 text-green-700 dark:text-green-400 px-3 py-2">
            <strong>{email}</strong> is on the allowed list. This user would be signed in.
          </p>
        ) : (
          <p className="mt-4 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
            <strong>{email}</strong> is not on the allowed list (SSO_ALLOWED_EMAILS).
          </p>
        )}

        <h2 className="text-sm font-medium mt-6 mb-2">Everything the SSO server sent</h2>
        {entries.length === 0 ? (
          <p className="text-sm text-subtle">No query parameters.</p>
        ) : (
          <table className="w-full text-sm border border-border rounded-md">
            <tbody>
              {entries.map(([k, v], i) => (
                <tr key={i} className="border-t border-border first:border-t-0 align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{k}</td>
                  <td className="px-3 py-2 break-all font-mono text-xs">{v || <span className="text-subtle">(empty)</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="text-xs text-subtle mt-6">
          Test page: no session is created yet. <Link href="/test-login" className="underline">Try again</Link>
        </p>
      </div>
    </div>
  );
}
