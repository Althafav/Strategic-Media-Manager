import Image from "next/image";
import Link from "next/link";
import { Link2, LogOut, Search, Users } from "lucide-react";
import { logout } from "@/app/login/actions";
import { getSession } from "@/lib/auth";

export async function Header() {
  const session = await getSession();
  const loggedIn = !!session;
  const logo = (
    <>
      <Image src="/mark.png" alt="" width={28} height={28} className="rounded-[5px]" priority />
      <span className="display text-[19px] tracking-normal hidden sm:inline">Strategic Media</span>
    </>
  );
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-14 flex items-center gap-3 sm:gap-5">
        {/* Logged-out visitors (login page, share links) can't use the app's home page, so the logo isn't a link. */}
        {loggedIn ? (
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {logo}
          </Link>
        ) : (
          <span className="flex items-center gap-2.5 shrink-0">{logo}</span>
        )}
        {session && (
          <>
            <form action="/search" className="flex-1 max-w-xl ml-auto relative">
              <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
              <input
                name="q"
                type="search"
                placeholder="Search by file or folder name"
                aria-label="Search files and folders"
                className="w-full h-9 rounded-md bg-background border border-transparent focus:border-foreground focus:bg-surface pl-9 pr-3 text-sm outline-none placeholder:text-subtle"
              />
            </form>
            <nav className="flex items-center">
              <Link
                href="/shares"
                title="Shared links"
                className="h-9 px-2.5 rounded-md text-sm text-subtle hover:text-foreground hover:bg-background inline-flex items-center gap-2"
              >
                <Link2 className="size-4" />
                <span className="hidden md:inline">Shared links</span>
              </Link>
              {session.role === "admin" && (
                <Link
                  href="/users"
                  title="Users"
                  className="h-9 px-2.5 rounded-md text-sm text-subtle hover:text-foreground hover:bg-background inline-flex items-center gap-2"
                >
                  <Users className="size-4" />
                  <span className="hidden md:inline">Users</span>
                </Link>
              )}
              <form action={logout}>
                <button
                  title={`Log out ${session.email ?? "admin"}`}
                  className="h-9 px-2.5 rounded-md text-sm text-subtle hover:text-foreground hover:bg-background inline-flex items-center gap-2"
                >
                  <LogOut className="size-4" />
                  <span className="hidden md:inline">Log out</span>
                </button>
              </form>
            </nav>
          </>
        )}
      </div>
    </header>
  );
}
