import { XMLParser, XMLValidator } from "fast-xml-parser";
export const FEED_MAX_BYTES = 2 * 1024 * 1024;

export async function readFeed(url: string, fetcher: typeof fetch = fetch): Promise<string> {
  const response = await fetcher(url, {
    headers: { "user-agent": "aperture/0.1" }, signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || Number(response.headers.get("content-length")) > FEED_MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("feed_unavailable");
  }
  if (!response.body) throw new Error("invalid_feed");
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
        throw new Error("feed_too_large");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString("utf8");
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false });

export function parseFeed(text: string) {
  if (XMLValidator.validate(text) !== true) throw new Error("invalid_feed");
  const xml = parser.parse(text);
  if (!xml?.rss?.channel || typeof xml.rss.channel !== "object") throw new Error("invalid_feed");
  const items = xml.rss.channel.item ?? [];
  return Array.isArray(items) ? items : [items];
}

