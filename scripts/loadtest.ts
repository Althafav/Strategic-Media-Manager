/**
 * Load test: N concurrent virtual users against a running instance (use `next build && next start`, not `next dev`).
 *
 *   npx tsx --env-file=.env.local scripts/loadtest.ts [baseUrl] [users] [seconds] < /dev/null
 *
 * Mints its own admin session cookie and share-gate cookie from .env.local (nothing is printed), so it never logs in
 * through the UI and writes no share_emails rows. The smm_viewed cookie is sent so share view_count is not inflated.
 * Redirects are NOT followed: OneDrive itself is never hit for file bytes. Thumb/download/manifest still make the app
 * call OneDrive for metadata, which is the real upstream limit this test is meant to surface.
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const USERS = Number(process.argv[3] ?? 100);
const SECONDS = Number(process.argv[4] ?? 60);
const RAMP_MS = 10_000;

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing from .env.local`);
  return v;
};

type Stat = { ms: number[]; status: Record<string, number> };
const stats = new Map<string, Stat>();

async function hit(label: string, path: string, init: RequestInit & { cookie?: string } = {}) {
  const { cookie, ...rest } = init;
  const t0 = performance.now();
  let status = "ERR";
  try {
    const res = await fetch(BASE + path, {
      redirect: "manual",
      ...rest,
      headers: { ...(cookie ? { cookie } : {}), ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    status = String(res.status);
    await res.arrayBuffer(); // drain so timing includes the body
  } catch (e) {
    status = (e as Error).name === "TimeoutError" ? "TIMEOUT" : "ERR";
  }
  const s = stats.get(label) ?? { ms: [], status: {} };
  s.ms.push(performance.now() - t0);
  s.status[status] = (s.status[status] ?? 0) + 1;
  stats.set(label, s);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const think = () => sleep(500 + Math.random() * 1500);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

async function main() {
  const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  // Admin session cookie, same format as lib/auth.ts createSessionToken.
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 3600_000, role: "admin" })).toString("base64url");
  const key = `${env("AUTH_SECRET")}:${env("AUTH_PASSWORD")}`;
  const sessionCookie = `smm_session=${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;

  // Pick a real event with indexed images, and a live folder share if one exists.
  const { data: events } = await db.from("events").select("id, slug, title").eq("hidden", false).limit(20);
  if (!events?.length) throw new Error("No events found");
  let ev: { id: string; slug: string } | null = null;
  let images: { id: string; parent_id: string | null }[] = [];
  for (const e of events) {
    const { data } = await db.from("nodes").select("id, parent_id").eq("event_id", e.id).eq("is_image", true).limit(60);
    if (data && data.length > images.length) {
      ev = e;
      images = data;
    }
  }
  if (!ev) throw new Error("No event with indexed images; run `npm run sync` first");
  const folders = (await db.from("nodes").select("id, name, path, child_count").eq("event_id", ev.id).eq("kind", "folder").gt("child_count", 0).order("child_count", { ascending: false }).limit(15)).data ?? [];

  const { data: shares } = await db
    .from("shares")
    .select("token, folder_id, expires_at")
    .eq("event_id", ev.id)
    .is("item_ids", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .limit(1);
  const share = shares?.[0];
  const shareImages = share ? images.filter((i) => i.parent_id === share.folder_id) : [];
  const sig = (id: string) => createHmac("sha256", env("AUTH_SECRET")).update(`share:${share!.token}:${id}`).digest("base64url").slice(0, 22);
  const gate = share ? createHmac("sha256", env("AUTH_SECRET")).update(`gate:${share.token}`).digest("base64url") : "";
  const shareCookie = share ? `smm_gate_${share.token}=${gate}; smm_viewed=1` : "";

  console.log(`Target ${BASE} | ${USERS} users | ${SECONDS}s (+${RAMP_MS / 1000}s ramp) | event ${ev.slug} | ${images.length} images | share link: ${share ? "yes" : "none (share scenario skipped)"}`);

  const teamUser = async () => {
    await hit("page /", "/", { cookie: sessionCookie }); await think();
    await hit("page /e/[slug]", `/e/${ev!.slug}`, { cookie: sessionCookie });
    for (const img of images.slice(0, 12)) await hit("api thumb 400 (team)", `/api/thumb/${img.id}?e=${ev!.slug}&s=400`, { cookie: sessionCookie });
    await think();
    if (folders.length) {
      const f = pick(folders); // real nested path: the stored `path` is the parent chain, so append the folder's own name
      const segs = [...String(f.path ?? "").split("/").filter(Boolean), f.name].map(encodeURIComponent).join("/");
      await hit("page folder (real path)", `/e/${ev!.slug}/${segs}`, { cookie: sessionCookie });
    }
    await hit("page /search", `/search?q=${pick(["IMG", "group", "stage", "award", "dsc"])}`, { cookie: sessionCookie }); await think();
    await hit("page /top", "/top", { cookie: sessionCookie });
    await hit("api thumb 1920 (team)", `/api/thumb/${pick(images).id}?e=${ev!.slug}&s=1920`, { cookie: sessionCookie });
    await hit("api download redirect", `/api/download/${pick(images).id}?e=${ev!.slug}`, { cookie: sessionCookie });
    if (Math.random() < 0.15) {
      await hit("api manifest (team, 1 folder)", "/api/manifest", {
        method: "POST", cookie: sessionCookie, headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: [{ event: ev!.slug, id: (folders.length ? pick(folders) : pick(images)).id }] }),
      });
    }
  };

  const shareUser = async () => {
    if (!share) return teamUser();
    await hit("page /s/[token] (gated ok)", `/s/${share.token}`, { cookie: shareCookie });
    const imgs = shareImages.length ? shareImages : images;
    for (const img of imgs.slice(0, 12)) await hit("api thumb 400 (share)", `/api/thumb/${img.id}?e=${ev!.slug}&t=${share.token}&sig=${sig(img.id)}`, { cookie: shareCookie });
    await think();
    await hit("api thumb 1920 (share)", `/api/thumb/${pick(imgs).id}?e=${ev!.slug}&t=${share.token}&sig=${sig(pick(imgs).id)}&s=1920`, { cookie: shareCookie });
  };

  const stopAt = Date.now() + RAMP_MS + SECONDS * 1000;
  const startedAt = Date.now();
  const users = Array.from({ length: USERS }, async (_, i) => {
    await sleep((i / USERS) * RAMP_MS); // staggered ramp-up
    const isShare = i % 2 === 1; // half team, half external
    while (Date.now() < stopAt) {
      await (isShare ? shareUser() : teamUser());
      await think();
    }
  });
  await Promise.all(users);
  const elapsed = (Date.now() - startedAt) / 1000;

  const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  const rows = [...stats.entries()].map(([label, s]) => {
    const a = [...s.ms].sort((x, y) => x - y);
    const total = a.length;
    const bad = Object.entries(s.status).filter(([k]) => !/^(2|3)\d\d$/.test(k)).reduce((n, [, v]) => n + v, 0);
    return { endpoint: label, reqs: total, "p50 ms": Math.round(q(a, 0.5)), "p95 ms": Math.round(q(a, 0.95)), "max ms": Math.round(a[a.length - 1]), "fail %": +((bad / total) * 100).toFixed(1), codes: JSON.stringify(s.status) };
  });
  console.table(rows);
  const total = rows.reduce((n, r) => n + r.reqs, 0);
  console.log(`Total ${total} requests in ${elapsed.toFixed(0)}s = ${(total / elapsed).toFixed(1)} req/s`);
}

main().catch((e) => { console.error(e); process.exit(1); });
