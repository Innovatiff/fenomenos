import test from "node:test";
import assert from "node:assert/strict";
import handler from "../netlify/functions/publish-articles.mjs";

test("only a verified editor can queue a build", async (t) => {
  process.env.NETLIFY_BUILD_HOOK_URL = "https://build.example.invalid/";
  process.env.FIREBASE_WEB_API_KEY = "fixture";
  process.env.STUDIO_EDITOR_EMAILS = "editor@example.invalid";
  let verified = false;
  let builds = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.method, "POST");
    if (url === process.env.NETLIFY_BUILD_HOOK_URL) {
      builds++;
      return new Response();
    }
    assert.equal(JSON.parse(options.body).idToken, "fixture-token");
    return Response.json({ users: [{ email: "editor@example.invalid", emailVerified: verified }] });
  });
  const request = new Request("https://studio.example.invalid/api/publish-articles", {
    method: "POST", headers: { Authorization: "Bearer fixture-token" },
  });
  assert.equal((await handler(new Request(request.url))).status, 405);
  assert.equal((await handler(new Request(request.url, { method: "POST" }))).status, 401);
  assert.equal((await handler(request)).status, 403);
  assert.equal(builds, 0);
  verified = true;
  const result = await handler(request);
  assert.equal(result.status, 202);
  assert.deepEqual(await result.json(), { accepted: true });
  assert.equal(builds, 1);
});
