import assert from "node:assert/strict";
import test from "node:test";
import { api, ApiError, UpgradeRequiredError } from "../src/lib/api.js";

test("multipart requests let fetch supply the boundary and preserve Headers objects", async (t) => {
  const form = new FormData();
  form.set("file", new File(["synthetic"], "resume.pdf", { type: "application/pdf" }));
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("content-type"), null);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer test");
    assert.equal(init.body, form);
    return Response.json({});
  });
  await api("/builder/upload", { method: "POST", body: form, headers: new Headers({ authorization: "Bearer test" }) });
});

test("API wrapper preserves save payload and caller credentials", async (t) => {
  const payload = { basics: { name: "Synthetic Candidate" } };
  let received: RequestInit | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      received = init;
      return Response.json({ version: 3 });
    },
  );
  assert.deepEqual(
    await api("/profile", {
      method: "PUT",
      body: JSON.stringify(payload),
      headers: { authorization: "Bearer synthetic-test" },
    }),
    { version: 3 },
  );
  assert.equal(received?.method, "PUT");
  assert.equal(
    new Headers(received?.headers).get("authorization"),
    "Bearer synthetic-test",
  );
  assert.equal(received?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(received?.body)), payload);
});

test("API failures expose status without disclosing raw server bodies", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("sensitive-server-detail", { status: 401 }),
  );
  await assert.rejects(
    api("/profile"),
    (error: unknown) =>
      error instanceof ApiError &&
      error.status === 401 &&
      !error.message.includes("sensitive-server-detail"),
  );
});

test("quota failures remain distinguishable and cancellation reaches fetch", async (t) => {
  const controller = new AbortController();
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      assert.equal(init.signal, controller.signal);
      return Response.json({ error: "upgrade_required" }, { status: 402 });
    },
  );
  await assert.rejects(
    api("/builder/improve-bullet", { signal: controller.signal }),
    UpgradeRequiredError,
  );
});
