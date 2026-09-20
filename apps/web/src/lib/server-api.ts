import { cookies } from "next/headers";
import { api as transport, ApiError } from "./api";
import { sessionToken } from "./browser-auth";

export { ApiError, UpgradeRequiredError } from "./api";
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const jar = await cookies();
  const cookie = jar.get(process.env.NODE_ENV === "production" ? "__Host-aperture-session" : "aperture-session")?.value;
  const token = await sessionToken(cookie);
  if (!token) throw new ApiError(401);
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer " + token);
  return transport<T>(path, { ...init, headers }, (process.env.API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787") + "/v1");
}
