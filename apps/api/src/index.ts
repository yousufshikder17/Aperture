import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createAuthMiddleware } from "./middleware/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { builderRoutes } from "./routes/builder.js";
import { listingRoutes } from "./routes/listings.js";
import { applicationRoutes } from "./routes/applications.js";
import { resourceRoutes } from "./routes/resources.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { templateRoutes } from "./routes/templates.js";
import { buildDigest } from "./jobs/digest.js";

// Business and authorization logic lives in the Hono API.
// The Next.js frontend is a thin client over these routes.

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    allowHeaders: ["Authorization", "Content-Type"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

const v1 = new Hono();
v1.use("*", createAuthMiddleware());
v1.get("/auth/me", (c) => {
  const user = c.get("user");
  return c.json({
    id: user.id,
    email: user.email,
    role: user.role,
    tier: user.tier,
    orgId: user.orgId,
  });
});
v1.route("/builder", builderRoutes); // entry-point module for new users
v1.route("/profile", profileRoutes);
v1.route("/listings", listingRoutes);
v1.route("/applications", applicationRoutes);
v1.route("/resources", resourceRoutes);
v1.route("/analytics", analyticsRoutes);
v1.route("/templates", templateRoutes);
// Today's top listings worth applying to (same payload the daily cron emails).
v1.get("/digest", async (c) => c.json(await buildDigest(c.get("user").id)));

app.route("/v1", v1);

const port = Number(process.env.API_PORT ?? 8787);
serve({ fetch: app.fetch, port });
console.log(`aperture api listening on :${port}`);
