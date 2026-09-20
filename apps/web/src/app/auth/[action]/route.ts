import { NextRequest, NextResponse } from "next/server";
import { authConfig, beginLogin, completeLogin, cookieOptions, sameOrigin } from "../../../lib/browser-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  if (!["login", "callback"].includes(action)) return new NextResponse(null, { status: 405 });
  try {
    const config = authConfig();
    if (action === "login") {
      const login = await beginLogin(config);
      const response = NextResponse.redirect(login.location, 303);
      response.cookies.set(config.flowCookie, login.cookie, cookieOptions(config, 600));
      response.headers.set("Cache-Control", "no-store");
      response.headers.set("Referrer-Policy", "no-referrer");
      return response;
    }
    const response = NextResponse.redirect(config.origin + "/builder", 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(config.flowCookie, "", cookieOptions(config, 0));
    try {
      const session = await completeLogin(config, request.nextUrl, request.cookies.get(config.flowCookie)?.value);
      response.cookies.set(config.sessionCookie, session.cookie, cookieOptions(config, session.seconds));
    } catch {
      response.headers.set("location", config.origin + "/account?error=signin");
    }
    return response;
  } catch {
    return new NextResponse("Sign-in is not configured or the identity provider is unavailable. Contact the operator and retry.",
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  if ((await context.params).action !== "logout") return new NextResponse(null, { status: 405 });
  try {
    const config = authConfig();
    if (!sameOrigin(request, config.origin)) return new NextResponse(null, { status: 403 });
    const response = NextResponse.redirect(config.origin + "/account", 303);
    response.cookies.set(config.sessionCookie, "", cookieOptions(config, 0));
    response.cookies.set(config.flowCookie, "", cookieOptions(config, 0));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch { return new NextResponse("Sign-out is unavailable: check authentication configuration.", { status: 503 }); }
}
