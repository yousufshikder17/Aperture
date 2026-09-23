// Typed frontend transport over the Hono API; authorization remains server-side.

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function developmentAuthorization(): Record<string, string> {
  if (process.env.NODE_ENV === "production") return {};
  const token = process.env.NEXT_PUBLIC_AUTH_DEV_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init?: RequestInit, base?: string): Promise<T> {
  const browser = typeof window !== "undefined";
  const headers = new Headers(browser ? undefined : developmentAuthorization());
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  if (!(init?.body instanceof FormData) && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  const res = await fetch(`${base ?? (browser ? "/api/backend" : BASE + "/v1")}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    redirect: "error",
    cache: "no-store",
  });
  if (res.status === 402) {
    throw new UpgradeRequiredError(await res.json());
  }
  if (!res.ok) {
    throw new ApiError(res.status);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API request failed (${status})`);
  }
}

export async function fetchMasterResumePdf(signal?: AbortSignal) {
  const response = await fetch("/api/backend/profile/pdf",
    { credentials: "same-origin", cache: "no-store", redirect: "error", signal });
  if (!response.ok) throw new ApiError(response.status);
  if (response.headers.get("content-type")?.split(";")[0] !== "application/pdf") throw new Error("invalid_pdf");
  const blob = await response.blob();
  if (!blob.size || await blob.slice(0, 5).text() !== "%PDF-") throw new Error("invalid_pdf");
  return blob;
}

export class UpgradeRequiredError extends Error {
  constructor(public detail: unknown) {
    super("upgrade_required");
  }
}
