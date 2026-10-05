import { lookup } from "node:dns/promises";
import { request } from "node:https";
import ipaddr from "ipaddr.js";
import { CareerUrlSchema } from "@aperture/shared";
import type { JobSourceContext, JobSourceError } from "./job-source.js";

export const CAREER_MAX_BYTES = 2 * 1024 * 1024;
export class CareerFetchError extends Error {
  constructor(readonly kind: JobSourceError["kind"], readonly code: string, readonly retryable = false) {
    super(code); this.name = "CareerFetchError";
  }
}
export function isPublicAddress(address: string) {
  try {
    const parsed = ipaddr.parse(address);
    // Mapped IPv6, transition ranges, documentation ranges and every special-use range fail closed.
    return parsed.range() === "unicast" &&
      (parsed.kind() === "ipv4" || parsed.match(ipaddr.parse("2000::"), 3));
  } catch { return false; }
}
export function validateCareerUrl(value: string, hosts: string[]): URL {
  if (!CareerUrlSchema.safeParse(value).success) throw new CareerFetchError("configuration", "unsafe_url");
  const url = new URL(value);
  if (!hosts.includes(url.hostname)) throw new CareerFetchError("configuration", "unexpected_hostname");
  return url;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export interface CareerPage { url: string; body: string; contentType: string; redirects: string[] }
type Address = { address: string; family: number };
export function createCareerReader(dependencies: {
  lookup?: (hostname: string) => Promise<Address[]>;
  request?: typeof request;
  maxBytes?: number;
} = {}) {
  const maxBytes = dependencies.maxBytes ?? CAREER_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024)
    throw new CareerFetchError("configuration", "invalid_response_limit");
  const resolve = dependencies.lookup ?? (hostname => lookup(hostname, { all: true, verbatim: true }));
  const connect = dependencies.request ?? request;
  return async (source: { url: string; expectedHostname: string; redirectHosts: string[] },
    value = source.url, context: JobSourceContext = {}): Promise<CareerPage> => {
    const timeoutMs = context.timeoutMs ?? 15_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000)
      throw new CareerFetchError("configuration", "invalid_timeout");
    const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(context.signal ? [context.signal] : [])]);
    const hosts = [source.expectedHostname, ...source.redirectHosts];
    const redirects: string[] = [];
    let url = validateCareerUrl(value, hosts);
    for (let hop = 0; hop <= 2; hop++) {
      signal.throwIfAborted();
      const addresses = await abortable(resolve(url.hostname), signal);
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address)))
        throw new CareerFetchError("configuration", "blocked_ip_destination");
      const pinned = addresses[0]!;
      const response = await new Promise<{ location?: string; page?: CareerPage }>((done, fail) => {
        const req = connect(url, {
          method: "GET", agent: false, family: pinned.family, signal,
          headers: { "user-agent": "Aperture-CareerPilot/0.1", accept: "text/html,application/json,application/ld+json",
            "accept-encoding": "identity" },
          // Resolve once, validate every answer, and pin the connection to that address (no DNS rebinding window).
          lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
        }, res => {
          const stop = (error: CareerFetchError) => { fail(error); res.destroy(); };
          const peer = res.socket.remoteAddress;
          if (!peer || ipaddr.process(peer).toString() !== ipaddr.process(pinned.address).toString())
            return stop(new CareerFetchError("configuration", "unexpected_peer"));
          const status = res.statusCode ?? 0;
          if ([301, 302, 303, 307, 308].includes(status)) {
            const location = res.headers.location;
            if (!location) return stop(new CareerFetchError("source", "invalid_redirect"));
            done({ location }); res.destroy(); return;
          }
          if (status < 200 || status >= 300)
            return stop(new CareerFetchError("source", status === 429 ? "rate_limited" :
              status === 401 || status === 403 ? "access_blocked" : "http_error", status === 429 || status >= 500 || status === 408));
          const contentType = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
          if (!["text/html", "application/xhtml+xml", "application/json", "application/ld+json"].includes(contentType))
            return stop(new CareerFetchError("payload", "unexpected_content_type"));
          if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")
            return stop(new CareerFetchError("payload", "unsupported_content_encoding"));
          if (Number(res.headers["content-length"]) > maxBytes)
            return stop(new CareerFetchError("payload", "response_too_large"));
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) return stop(new CareerFetchError("payload", "response_too_large"));
            chunks.push(chunk);
          });
          res.on("error", fail);
          res.on("end", () => done({ page: { url: url.href, body: Buffer.concat(chunks).toString("utf8"),
            contentType, redirects } }));
        });
        req.on("error", fail);
        req.end();
      });
      if (response.page) return response.page;
      const next = validateCareerUrl(new URL(response.location!, url).href, hosts);
      redirects.push(next.href);
      url = next;
    }
    throw new CareerFetchError("configuration", "too_many_redirects");
  };
}
export type CareerReader = ReturnType<typeof createCareerReader>;
