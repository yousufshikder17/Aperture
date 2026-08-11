import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { applications, db } from "@aperture/db";

export const applicationRoutes = new Hono();

const CreateSchema = z.object({
  listingId: z.string().uuid(),
  status: z
    .enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "withdrawn"])
    .default("saved"),
  notes: z.string().optional(),
});

const PatchSchema = z.object({
  status: z.enum(["saved", "applied", "screening", "interviewing", "offer", "rejected", "withdrawn"]),
  notes: z.string().optional(),
});

applicationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db()
    .select()
    .from(applications)
    .where(eq(applications.userId, user.id))
    .orderBy(desc(applications.createdAt));
  return c.json(rows);
});

applicationRoutes.post("/", zValidator("json", CreateSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const now = new Date();
  const rows = await db()
    .insert(applications)
    .values({
      userId: user.id,
      listingId: body.listingId,
      status: body.status,
      notes: body.notes,
      appliedAt: body.status === "applied" ? now : null,
      events: [{ status: body.status, at: now.toISOString() }],
    })
    .returning();
  return c.json(rows[0], 201);
});

// Status transitions append to the events log — the append-only history is what
// the DuckDB ETL turns into response-rate analytics.
applicationRoutes.patch("/:id", zValidator("json", PatchSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const rows = await db().select().from(applications).where(eq(applications.id, c.req.param("id")));
  const app = rows[0];
  if (!app || app.userId !== user.id) return c.json({ error: "not_found" }, 404);

  const now = new Date();
  const updated = await db()
    .update(applications)
    .set({
      status: body.status,
      notes: body.notes ?? app.notes,
      appliedAt: app.appliedAt ?? (body.status === "applied" ? now : null),
      events: [...app.events, { status: body.status, at: now.toISOString() }],
    })
    .where(eq(applications.id, app.id))
    .returning();
  return c.json(updated[0]);
});
