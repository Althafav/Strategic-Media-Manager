/**
 * Obtains read access to an anonymous OneDrive for Business share link.
 *
 * Chain: share link (guest FedAuth cookie) -> /_api/contextinfo (form digest)
 * -> RenderListDataAsStream (ListSchema[".driveAccessToken"]). That token is a
 * bearer for the v2.0 drive API, scoped to the shared folder, valid ~5h.
 * This is not an official API; keep all knowledge of it in this module.
 */

export type DriveSession = {
  token: string;
  driveUrl: string; // https://host/_api/v2.0/drives/{driveId}
  rootId: string; // item id of the shared folder
  rootName: string;
  expiresAt: number; // epoch ms
};

const REFRESH_MARGIN_MS = 10 * 60 * 1000;

// One session per share link (each event has its own link).
const cached = new Map<string, DriveSession>();
const inflight = new Map<string, Promise<DriveSession>>();

export async function getSession(shareUrl: string): Promise<DriveSession> {
  const hit = cached.get(shareUrl);
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit;
  let pending = inflight.get(shareUrl);
  if (!pending) {
    pending = acquire(shareUrl)
      .then((s) => (cached.set(shareUrl, s), s))
      .finally(() => inflight.delete(shareUrl));
    inflight.set(shareUrl, pending);
  }
  return pending;
}

export function invalidateSession(shareUrl: string) {
  cached.delete(shareUrl);
}

/** Only SharePoint / OneDrive for Business folder links are supported. */
export function isSupportedShareUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith(".sharepoint.com") && /^\/:f:\//.test(u.pathname);
  } catch {
    return false;
  }
}

async function acquire(shareUrl: string): Promise<DriveSession> {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

  // 1. Follow the share link manually so we can collect the guest cookie and
  //    read the folder path from the final redirect (onedrive.aspx?id=...).
  let url = shareUrl;
  let folderPath: string | null = null;
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(url, { redirect: "manual", headers: { cookie: cookie() } });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
    }
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url).toString();
      folderPath = new URL(url).searchParams.get("id") ?? folderPath;
      continue;
    }
    if (!res.ok) throw new Error(`Share link returned ${res.status}`);
    break;
  }
  if (!jar.has("FedAuth")) throw new Error("Share link did not grant guest access (no FedAuth cookie)");
  if (!folderPath) throw new Error("Could not resolve shared folder path from share link");

  // folderPath: /personal/{site}/Documents/{shared folder}
  const origin = new URL(url).origin;
  const segments = folderPath.split("/").filter(Boolean);
  const siteUrl = `${origin}/${segments.slice(0, 2).join("/")}`;
  const listPath = `/${segments.slice(0, 3).join("/")}`;

  // 2. Form digest for the POST below.
  const ctx = await fetch(`${siteUrl}/_api/contextinfo`, {
    method: "POST",
    headers: { cookie: cookie(), accept: "application/json;odata=nometadata" },
  });
  if (!ctx.ok) throw new Error(`contextinfo returned ${ctx.status}`);
  const { FormDigestValue } = (await ctx.json()) as { FormDigestValue: string };

  // 3. RenderListDataAsStream exposes the drive access token in its schema.
  const rlds = new URL(`${siteUrl}/_api/web/GetListUsingPath(DecodedUrl=@a1)/RenderListDataAsStream`);
  rlds.searchParams.set("@a1", `'${listPath}'`);
  rlds.searchParams.set("RootFolder", folderPath);
  const res = await fetch(rlds, {
    method: "POST",
    headers: {
      cookie: cookie(),
      accept: "application/json;odata=nometadata",
      "content-type": "application/json;odata=nometadata",
      "x-requestdigest": FormDigestValue,
    },
    body: JSON.stringify({
      parameters: { RenderOptions: 5707527, AddRequiredFields: true, ViewXml: "<View><RowLimit>1</RowLimit></View>" },
    }),
  });
  if (!res.ok) throw new Error(`RenderListDataAsStream returned ${res.status}`);
  const data = (await res.json()) as {
    ListSchema?: Record<string, string>;
    ListData?: { CurrentFolderSpItemUrl?: string };
  };

  const rawToken = data.ListSchema?.[".driveAccessToken"];
  const driveUrl = data.ListSchema?.[".driveUrl"];
  const rootId = data.ListData?.CurrentFolderSpItemUrl?.match(/\/items\/([^?/]+)/)?.[1];
  if (!rawToken || !driveUrl || !rootId) throw new Error("Drive access token not present in list response");

  const token = rawToken.replace(/^access_token=/, "");
  return {
    token,
    driveUrl: driveUrl.replace(/\/$/, ""),
    rootId,
    rootName: segments.at(-1) ?? "Media",
    expiresAt: tokenExpiry(token),
  };
}

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    const exp = Number(payload.exp);
    if (Number.isFinite(exp)) return exp * 1000;
  } catch {}
  return Date.now() + 60 * 60 * 1000;
}
