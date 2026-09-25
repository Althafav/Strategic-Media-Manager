import Image from "next/image";
import { appBaseUrl, ssoLoginUrl } from "@/lib/sso";

export const metadata = { title: "Test SSO · Strategic Media Manager", robots: { index: false } };
export const dynamic = "force-dynamic";

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

export default async function TestLoginPage() {
  const href = await ssoLoginUrl();
  const base = await appBaseUrl();

  return (
    <div className="min-h-[70vh] grid place-items-center py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
        <Image src="/mark.png" alt="" width={40} height={40} className="rounded-md" />
        <h1 className="display text-4xl mt-5">Test SSO</h1>
        <p className="text-sm text-subtle mt-2 mb-6">Sign in with your Strategic Microsoft account.</p>

        <a
          href={href}
          className="w-full h-10 rounded-md border border-border bg-background text-sm font-medium inline-flex items-center justify-center gap-2 hover:bg-surface"
        >
          <MicrosoftLogo />
          Sign in with Microsoft
        </a>

        <p className="text-xs text-subtle mt-6 break-all">
          Returns to <code>{base}/sso-login</code>
        </p>
      </div>
    </div>
  );
}
