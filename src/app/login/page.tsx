import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in · Strategic Media Manager" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const nextPath = typeof next === "string" ? next : "/";
  if (await getSession()) redirect(nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/");

  return (
    <div className="min-h-[70vh] grid place-items-center py-12">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6 sm:p-8">
        <Image src="/mark.png" alt="" width={40} height={40} className="rounded-md" />
        <h1 className="display text-4xl mt-5">Sign in</h1>
        <p className="text-sm text-subtle mt-2 mb-6">Strategic Media Manager is for the internal team only.</p>
        <LoginForm next={nextPath} />
      </div>
    </div>
  );
}
