import { NextRequest } from "next/server";
import { sessionToken } from "../../../../lib/browser-auth";
import { proxyRequest } from "../../../../lib/api-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  try {
    const production = process.env.NODE_ENV === "production";
    const cookie = request.cookies.get(production ? "__Host-aperture-session" : "aperture-session")?.value;
    const token = await sessionToken(cookie);
    const origin = process.env.WEB_APP_URL ? new URL(process.env.WEB_APP_URL).origin
      : production ? "" : request.nextUrl.origin;
    return await proxyRequest(request, (await context.params).path, token,
      process.env.API_BASE_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787", origin);
  } catch { return Response.json({ error: "authentication_required" }, { status: 401 }); }
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as HEAD };
