/** Sends mail through the AIM Congress generic email API. Server-only. */
const SEND_EMAIL_URL = "https://payment.aimcongress.com/api/Generic/SendEmail";
const SENDER = "no-reply@strategic.ae";

/** Best-effort: never throws, returns whether the API accepted the message. */
export async function sendEmail(input: { to: string; subject: string; body: string }): Promise<boolean> {
  try {
    const res = await fetch(SEND_EMAIL_URL, {
      method: "POST",
      // The API's firewall answers 403 to Node's default User-Agent.
      headers: { "Content-Type": "application/json", "User-Agent": "StrategicMediaManager/1.0", Accept: "application/json" },
      body: JSON.stringify({
        sender_email: SENDER,
        email_to: input.to,
        subject: input.subject,
        body: input.body,
        file_path: "",
        file_name: "",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`SendEmail failed: HTTP ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error("SendEmail failed:", e);
    return false;
  }
}
