import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { createBuilderRoutes } from "../src/routes/builder.js";

test("resume upload bounds the whole multipart stream before extraction", async () => {
  let calls = 0;
  const app = new Hono();
  app.route("/builder", createBuilderRoutes({
    env: { MAX_RESUME_UPLOAD_BYTES: "1024" },
    extractPdf: async () => { calls++; return { resume: {}, layoutFindings: [] } as never; },
  }));
  for (const transferEncoding of [false, true]) {
    const form = new FormData();
    form.set("file", new File(["%PDF-fixture"], "resume.pdf", { type: "application/pdf" }));
    form.set("padding", "x".repeat(100_000));
    const request = new Request("http://localhost/builder/upload", { method: "POST", body: form,
      headers: transferEncoding ? { "transfer-encoding": "chunked" } : {} });
    assert.equal(request.headers.has("content-length"), false);
    const response = await app.request(request);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "payload_too_large", maxBytes: 1024 });
  }
  assert.equal(calls, 0);
  const valid = new FormData();
  valid.set("file", new File([new Uint8Array(1024)], "resume.pdf", { type: "application/pdf" }));
  assert.equal((await app.request("/builder/upload", { method: "POST", body: valid })).status, 200);
  assert.equal(calls, 1);
});
