import { createClient } from "@supabase/supabase-js";
async function main() {
  const c = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const [op, email] = process.argv.slice(2);
  const r = op === "add" ? await c.from("app_users").insert({ email, name: "Test User" }) : op === "del" ? await c.from("app_users").delete().eq("email", email) : await c.from("app_users").select("email,last_login_at");
  console.log(op, r.error ? `ERROR ${r.error.message}` : JSON.stringify(r.data ?? "ok"));
}
main();
