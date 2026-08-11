// Typed frontend transport over the Hono API; authorization remains server-side.

const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";

function developmentAuthorization(): Record<string, string> {
  if (process.env.NODE_ENV === "production") return {};
  const token = process.env.NEXT_PUBLIC_AUTH_DEV_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}/v1${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...developmentAuthorization(),
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (res.status === 402) {
    throw new UpgradeRequiredError(await res.json());
  }
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export class UpgradeRequiredError extends Error {
  constructor(public detail: unknown) {
    super("upgrade_required");
  }
}
