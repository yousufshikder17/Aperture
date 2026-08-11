import { createMiddleware } from "hono/factory";
import type { ApplicationRole } from "../auth/development-identities.js";

export function requireRole(requiredRole: ApplicationRole) {
  return createMiddleware(async (c, next) => {
    const user = c.get("user");
    if (user.role !== requiredRole) {
      return c.json({ error: "forbidden", requiredRole }, 403);
    }
    await next();
  });
}

export const requireAdmin = () => requireRole("admin");
