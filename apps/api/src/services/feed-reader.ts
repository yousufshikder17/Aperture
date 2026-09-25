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
