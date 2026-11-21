const json = (status, body) => Response.json(body, { status });

export default async function handler(event) {
  if (event.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const hook = process.env.NETLIFY_BUILD_HOOK_URL;
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const allowedEmails = (process.env.STUDIO_EDITOR_EMAILS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const token = /^Bearer\s+(\S+)$/i.exec(event.headers.get("authorization") || "")?.[1];
  if (!token) return json(401, { error: "firebase_token_required" });
  if (!hook || !apiKey || !allowedEmails.length) {
    return json(503, { error: "publication_trigger_not_configured" });
  }

  try {
    const identity = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      },
    );
    if (!identity.ok) return json(401, { error: "invalid_firebase_token" });
    const account = await identity.json();
    const email = String(account.users?.[0]?.email || "").toLowerCase();
    if (!account.users?.[0]?.emailVerified || !allowedEmails.includes(email)) {
      return json(403, { error: "editor_not_allowed" });
    }

    const build = await fetch(hook, { method: "POST" });
    if (!build.ok) return json(502, { error: "netlify_build_hook_failed" });
    return json(202, { accepted: true });
  } catch {
    return json(502, { error: "publication_trigger_failed" });
  }
}
