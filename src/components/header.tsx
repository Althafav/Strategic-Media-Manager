import Image from "next/image";
import Link from "next/link";
import { Search } from "lucide-react";
import { getSession } from "@/lib/auth";
import { inboxSeenAt, pendingCountFor, unseenAnswersFor } from "@/lib/requests";
import { isPending, listUsers, normalizeEmail } from "@/lib/users";
import { UserMenu } from "./user-menu";

export async function Header() {
  const session = await getSession();
  const loggedIn = !!session;
  const pendingCount =
    session?.role === "admin" ? (await listUsers().catch(() => [])).filter(isPending).length : 0;
  // Photo requests sent to this coordinator (or the admin) since they last opened the Inbox, plus answers to their
  // own requests they haven't seen yet. Each part is 0 until its migration (0011 / 0013) runs.
  const [newRequests, newReplies] = session
    ? await Promise.all([
        pendingCountFor(session, await inboxSeenAt()).catch(() => 0),
        unseenAnswersFor(session).catch(() => 0),
      ])
    : [0, 0];
  // The user's name from app_users, else "john.doe@x.com" -> "John Doe". The password login is "Admin".
  const displayName = !session
    ? ""
    : !session.email
      ? "Admin"
      : (await listUsers().catch(() => [])).find((u) => u.email === normalizeEmail(session.email!))?.name?.trim() ||
        session.email
          .split("@")[0]
          .split(/[._-]+/)
          .filter(Boolean)
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(" ");
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
            <UserMenu
              name={displayName}
              email={session.email}
              isAdmin={session.role === "admin"}
              newRequests={newRequests}
              newReplies={newReplies}
              pendingCount={pendingCount}
            />
          </>
        )}
      </div>
    </header>
  );
}
