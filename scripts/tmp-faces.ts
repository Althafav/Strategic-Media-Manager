// TEMPORARY read-only check of the face index after migration 0025. Delete after use.
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: events, error } = await db.from("events").select("*");
  if (error) throw error;
  const cols = Object.keys(events[0] ?? {}).filter((k) => k.startsWith("face"));
  console.log("face columns on events:", cols.join(", "));
  for (const e of events) {
    const scans = await db.from("face_scans").select("item_id", { count: "exact", head: true }).eq("event_id", e.id);
    const embs = await db.from("face_embeddings").select("item_id", { count: "exact", head: true }).eq("event_id", e.id);
    const people = await db.from("face_people").select("id", { count: "exact", head: true }).eq("event_id", e.id);
    const last = await db.from("face_scans").select("scanned_at").eq("event_id", e.id).order("scanned_at", { ascending: true }).limit(1);
    console.log(
      `${e.slug}: face_scan=${e.face_scan} face_search=${e.face_search} scans=${scans.count} faces=${embs.count} people=${people.count} oldest_scan=${last.data?.[0]?.scanned_at ?? "-"}`,
    );
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
