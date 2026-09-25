import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession, safeNext } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Strategic Media Manager" };

const SSO_ERRORS: Record<string, string> = {
  sso_denied: "That Microsoft account doesn't have access. Ask an admin to add you.",
  sso_expired: "The Microsoft sign-in took too long or was started elsewhere. Try again.",
};

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" className="size-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  const nextPath = safeNext(typeof next === "string" ? next : "/");
  if (await getSession()) redirect(nextPath);
  const ssoError = typeof error === "string" ? SSO_ERRORS[error] : undefined;

  return (
    <div className="min-h-[70vh] grid place-items-center py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
        <Image src="/mark.png" alt="" width={40} height={40} className="rounded-md" />
        <h1 className="display text-4xl mt-5">Sign in</h1>
        <p className="text-sm text-subtle mt-2 mb-6">Strategic Media Manager is for the internal team only.</p>

        {ssoError && (
          <p role="alert" className="mb-4 text-sm rounded-md border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-2">
            {ssoError}
          </p>
        )}

        <a
          href={`/api/auth/sso?next=${encodeURIComponent(nextPath)}`}
          className="w-full h-10 rounded-md border border-border bg-background text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-surface"
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </a>

        <div className="flex items-center gap-3 my-6 text-xs text-subtle">
          <span className="h-px flex-1 bg-border" />
          or use the team login
          <span className="h-px flex-1 bg-border" />
        </div>

        <LoginForm next={nextPath} />
      </div>
    </div>
  );
}
