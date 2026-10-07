import { getSession } from "@/lib/auth";
import { getVisibleEvent, type EventRow } from "@/lib/events";
import { canViewShare } from "@/lib/share-emails";
import { getActiveShare, verifyItem } from "@/lib/shares";

/**
 * Decides which event a media API request may read from:
 * - logged-in team members: the event named by `?e=`, if they may see it (private events, canSeeEvent)
 * - share-link visitors: the share's event, and only for ids signed for that share (`?t=&sig=`),
 *   once they have passed the email gate for that link (`canViewShare`)
 */
export async function resolveItemAccess(params: URLSearchParams, id: string): Promise<EventRow | null> {
  const token = params.get("t");
  if (token) {
    const active = await getActiveShare(token).catch(() => null);
    return active && verifyItem(token, id, params.get("sig")) && (await canViewShare(token)) ? active.event : null;
  }
  if (!(await getSession())) return null;
  return getVisibleEvent(params.get("e") ?? ""); // private events: admin + listed viewers only
}
