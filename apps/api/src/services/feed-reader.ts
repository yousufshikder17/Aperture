import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { JobSourceContext, JobSourceError } from "./job-source.js";

export const FEED_MAX_BYTES = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });
export class FeedReadError extends Error {
  constructor(readonly kind: JobSourceError["kind"], readonly code: string, readonly retryable: boolean) {
    super(code); this.name = "FeedReadError";
  }
}
export function validateFeedUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
  } catch { throw new FeedReadError("configuration", "invalid_feed_url", false); }
}
export function parseFeed(text: string): unknown[] {
  try {
    if (XMLValidator.validate(text) !== true) throw new Error();
    const channel = parser.parse(text)?.rss?.channel;
    if (channel === "") return [];
    if (!channel || typeof channel !== "object" || Array.isArray(channel)) throw new Error();
    const items = channel.item ?? [];
    return Array.isArray(items) ? items : [items];
  } catch { throw new FeedReadError("payload", "invalid_feed", false); }
}
export async function fetchFeedText(url: string, fetcher: typeof fetch = fetch,
  context: Pick<JobSourceContext, "signal" | "timeoutMs"> = {}): Promise<string> {
  validateFeedUrl(url);
  const timeoutMs = context.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
    throw new FeedReadError("configuration", "invalid_timeout", false);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, {
    headers: { "user-agent": "aperture/0.1" },
    signal: context.signal ? AbortSignal.any([context.signal, timeout]) : timeout,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new FeedReadError("source", "http_error", response.status === 408 || response.status === 429 || response.status >= 500);
  }
  if (Number(response.headers.get("content-length")) > FEED_MAX_BYTES) {
    await response.body?.cancel();
    throw new FeedReadError("payload", "feed_too_large", false);
  }
  if (!response.body) throw new FeedReadError("payload", "invalid_feed", false);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEED_MAX_BYTES) {
        await reader.cancel();
        throw new FeedReadError("payload", "feed_too_large", false);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

export const readFeed = fetchFeedText;
