import { sameOrigin } from "./browser-auth";

export async function proxyRequest(request: Request, path: string[], token: string | null, base: string, origin: string) {
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(request.method))
    return new Response(null, { status: 405 });
  if (!path.length || path.some(part => !/^[a-zA-Z0-9_-]+$/.test(part)))
    return new Response(null, { status: 400 });
  if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request, origin))
    return new Response(null, { status: 403 });
  if (!token) return Response.json({ error: "authentication_required" }, { status: 401 });
  const target = new URL(base.replace(/\/$/, "") + "/v1/" + path.join("/"));
  target.search = new URL(request.url).search;
  const headers = new Headers({ authorization: "Bearer " + token });
  const type = request.headers.get("content-type");
  if (type) headers.set("content-type", type);
  try {
    // Bound uploads even when content-length is absent or deliberately misleading.
    const max = 8 * 1024 * 1024 + 64 * 1024;
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (request.body) {
      const reader = request.body.getReader();
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > max) { await reader.cancel(); return new Response(null, { status: 413 }); }
        chunks.push(part.value);
      }
    }
    const body = size ? Buffer.concat(chunks) : undefined;
    const upstream = await fetch(target, { method: request.method, headers, body, cache: "no-store",
      redirect: "error", signal: request.signal });
    const responseHeaders = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-type", "content-disposition"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch { return Response.json({ error: "api_unavailable" }, { status: 502 }); }
}
