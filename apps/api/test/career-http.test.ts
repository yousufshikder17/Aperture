import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { request } from "node:https";
import { CAREER_MAX_BYTES, createCareerReader, isPublicAddress, validateCareerUrl } from "../src/services/career-http.js";


const source = { url: "https://api.example.com/jobs", expectedHostname: "api.example.com", redirectHosts: [] as string[] };
function network(replies: Array<{ status?: number; headers?: Record<string, string>; body?: string | Buffer; peer?: string }>, maxBytes?: number) {
  const urls: string[] = [];
  const connect = ((url: URL, options: Record<string, any>, receive: (response: any) => void) => {
    urls.push(url.href);
    assert.equal(options.agent, false);
    assert.equal(options.headers.authorization, undefined);
    options.lookup(url.hostname, {}, (_error: unknown, address: string) => assert.equal(address, "93.184.216.34"));
    const req = new EventEmitter() as EventEmitter & { end: () => void };
    req.end = () => queueMicrotask(() => {
      const reply = replies.shift()!;
      const res = Object.assign(new PassThrough(), { statusCode: reply.status ?? 200,
        headers: { "content-type": "text/html", ...reply.headers }, socket: { remoteAddress: reply.peer ?? "93.184.216.34" } });
      receive(res);
      if (!res.destroyed) res.end(reply.body ?? "<html/>");
    });
    return req;
  }) as unknown as typeof request;
  return { urls, read: createCareerReader({ request: connect, lookup: async () => [{ address: "93.184.216.34", family: 4 }],
    ...(maxBytes === undefined ? {} : { maxBytes }) }) };
}
test("career transport blocks non-public IPs, insecure URLs and unexpected hosts", () => {
  for (const address of ["127.0.0.1", "10.2.3.4", "172.16.1.1", "192.168.1.1", "169.254.169.254",
    "0.0.0.0", "100.64.0.1", "192.0.2.1", "224.0.0.1", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1",
    "2001:db8::1", "2002:7f00:1::", "::"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const url of ["file:///etc/passwd", "http://api.example.com/", "https://localhost/", "https://127.1/",
    "https://api.example.com.evil.test/", "https://user:secret@api.example.com/", "https://api.example.com:444/"])
    assert.throws(() => validateCareerUrl(url, [source.expectedHostname]));
});
test("DNS validation rejects mixed public/private answers before connecting", async () => {
  let connections = 0;
  const read = createCareerReader({ lookup: async () => [
    { address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }],
    request: (() => { connections++; throw new Error(); }) as never });
  await assert.rejects(read(source), /blocked_ip_destination/);
  assert.equal(connections, 0);
});
test("approved redirects are revalidated and unrelated hosts are never contacted", async () => {
  const valid = network([{ status: 302, headers: { location: "/en/jobs/123" } }, { body: "job" }]);
  assert.equal((await valid.read(source)).url, "https://api.example.com/en/jobs/123");
  assert.equal(valid.urls.length, 2);
  for (const location of ["https://evil.test/", "http://api.example.com/", "https://127.0.0.1/"]) {
    const blocked = network([{ status: 302, headers: { location } }]);
    await assert.rejects(blocked.read(source));
    assert.equal(blocked.urls.length, 1);
  }
  await assert.rejects(network([{ status: 302, headers: { location: "/" } },
    { status: 302, headers: { location: "/" } }, { status: 302, headers: { location: "/" } }]).read(source), /too_many_redirects/);
});
test("transport enforces peer, MIME, declared and streamed size, and HTTP failures", async () => {
  for (const [reply, code] of [
    [{ peer: "127.0.0.1" }, /unexpected_peer/],
    [{ headers: { "content-type": "application/octet-stream" } }, /unexpected_content_type/],
    [{ headers: { "content-length": String(CAREER_MAX_BYTES + 1) } }, /response_too_large/],
    [{ body: Buffer.alloc(CAREER_MAX_BYTES + 1) }, /response_too_large/],
    [{ status: 403 }, /access_blocked/], [{ status: 429 }, /rate_limited/],
  ] as const) await assert.rejects(network([reply]).read(source), code);
  await assert.rejects(network([{ status: 429 }]).read(source), error => {
    assert.equal((error as Error & { retryable: boolean }).retryable, true); return true;
  });
});
test("transport honors a caller-selected response cap and rejects caps above its hard maximum", async () => {
  await assert.rejects(network([{ headers: { "content-length": "4" } }], 3).read(source), /response_too_large/);
  assert.throws(() => createCareerReader({ maxBytes: 16 * 1024 * 1024 + 1 }), /invalid_response_limit/);
});

test("explicit related-host redirects retain DNS checks and never authorize a third host", async () => {
  const configured = {...source, redirectHosts: ["careers.example.com"]};
  const related = network([{status: 302, headers: {location: "https://careers.example.com/jobs"}}, {body: "job"}]);
  assert.equal((await related.read(configured)).url, "https://careers.example.com/jobs");
  assert.equal(related.urls.length, 2);
  const unrelated = network([{status: 302, headers: {location: "https://careers.example.com/jobs"}},
    {status: 302, headers: {location: "https://unapproved.example.com/jobs"}}]);
  await assert.rejects(unrelated.read(configured), /unexpected_hostname/);
  assert.equal(unrelated.urls.length, 2);
  let lookups = 0;
  const privateRedirect = createCareerReader({lookup: async () => [{address: ++lookups === 1 ? "93.184.216.34" : "127.0.0.1", family: 4}],
    request: ((_url: URL, _options: unknown, receive: (response: any) => void) => {
      const req = new EventEmitter() as EventEmitter & {end: () => void};
      req.end = () => receive(Object.assign(new PassThrough(), {statusCode: 302, socket: {remoteAddress: "93.184.216.34"},
        headers: {location: "https://careers.example.com/jobs"}}));
      return req;
    }) as unknown as typeof request});
  await assert.rejects(privateRedirect(configured), /blocked_ip_destination/);
});
test("timeouts and cancellation also bound DNS resolution", async () => {
  const read = createCareerReader({ lookup: () => new Promise(() => {}) });
  // Keep a fixture timer alive; AbortSignal.timeout intentionally does not keep Node alive.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(read(source, source.url, { timeoutMs: 5 }), { name: "TimeoutError" });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(read(source, source.url, { signal: controller.signal }), { name: "AbortError" });
  } finally { clearTimeout(keepAlive); }
});
