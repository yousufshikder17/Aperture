import assert from "node:assert/strict";
import test from "node:test";
import { proxyRequest } from "../src/lib/api-proxy.js";

const origin = "https://web.example.test";
const base = "https://api.example.test";
test("proxy denies anonymous, cross-site, missing-origin and traversal requests before fetch", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not fetch"); });
  assert.equal((await proxyRequest(new Request(origin), ["profile"], null, base, origin)).status, 401);
  for (const headers of [new Headers(), new Headers({ origin: "https://other.test" })])
    assert.equal((await proxyRequest(new Request(origin, { method: "PUT", headers }), ["profile"], "secret", base, origin)).status, 403);
  for (const path of [[".."], ["https://other.test"], ["%2e%2e"], []])
    assert.equal((await proxyRequest(new Request(origin), path, "secret", base, origin)).status, 400);
});
test("proxy forwards session identity, multipart boundary and status, never caller identity or cookies", async t => {
  const form = new FormData();
  form.set("file", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
  const request = new Request(origin + "/api/backend/builder/upload", { method: "POST", body: form,
    headers: { origin, authorization: "Bearer forged", cookie: "unrelated=secret", "x-tier": "pro" } });
  t.mock.method(globalThis, "fetch", async (url: URL, init: RequestInit) => {
    assert.equal(url.href, base + "/v1/builder/upload");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer session");
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("x-tier"), null);
    const parsed = await new Request(url, { method: "POST", headers, body: init.body }).formData();
    assert.equal((parsed.get("file") as File).name, "resume.pdf");
    assert.equal(init.redirect, "error");
    return Response.json({ error: "quota" }, { status: 402, headers: { "set-cookie": "leak=1" } });
  });
  const result = await proxyRequest(request, ["builder", "upload"], "session", base, origin);
  assert.equal(result.status, 402);
  assert.equal(result.headers.get("set-cookie"), null);
  assert.equal(result.headers.get("cache-control"), "no-store");
});
test("proxy caps unknown-length request bodies and sanitizes upstream failures", async t => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("secret backend"); });
  const large = new Request(origin, { method: "POST", headers: { origin }, body: new Uint8Array(9 * 1024 * 1024) });
  assert.equal((await proxyRequest(large, ["builder", "upload"], "session", base, origin)).status, 413);
  const result = await proxyRequest(new Request(origin), ["profile"], "session", base, origin);
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes("secret backend"));
});
