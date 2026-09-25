import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cleanName, folderHref } from "@/lib/format";

/**
 * `base` is the URL of the top folder (`/e/<slug>` in the app, `/s/<token>` on share pages).
 * Share pages hide the "Events" link, since visitors can't go above the shared folder.
 */
export function Breadcrumbs({
  base,
  rootLabel,
  path,
  showEvents = true,
}: {
  base: string;
  rootLabel: string;
  path: string[];
  showEvents?: boolean;
}) {
  const crumbs = [{ label: cleanName(rootLabel), href: base }].concat(
    path.map((seg, i) => ({ label: cleanName(seg), href: folderHref(base, path.slice(0, i + 1)) })),
  );
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-sm text-subtle flex-wrap pt-5">
      {showEvents && (
        <Link href="/" className="hover:text-foreground">
          Events
        </Link>
      )}
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          {(showEvents || i > 0) && <ChevronRight className="size-3.5" />}
          {i === crumbs.length - 1 ? (
            <span className="text-foreground">{c.label}</span>
          ) : (
            <Link href={c.href} className="hover:text-foreground">
              {c.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
