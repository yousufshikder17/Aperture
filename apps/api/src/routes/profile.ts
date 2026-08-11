import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq, sql } from "drizzle-orm";
import { db, profiles, resumeVersions } from "@aperture/db";
import { MasterResumeSchema, ReferenceListSchema } from "@aperture/shared";
import { enqueueRecalc } from "../jobs/recalc.js";
import { renderResumePdf } from "../lib/pdf-export.js";

export const profileRoutes = new Hono();

profileRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db().select().from(profiles).where(eq(profiles.userId, user.id));
  return c.json(rows[0] ?? { userId: user.id, masterResume: null, referenceList: null, version: 0 });
});

// Each write bumps the version, stores a snapshot, and schedules background
// recalculation without blocking the profile update.
profileRoutes.put("/", zValidator("json", MasterResumeSchema), async (c) => {
  const user = c.get("user");
  const masterResume = c.req.valid("json");

  const rows = await db()
    .insert(profiles)
    .values({ userId: user.id, masterResume, version: 1 })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { masterResume, version: sql`${profiles.version} + 1`, updatedAt: new Date() },
    })
    .returning();
  const saved = rows[0]!;

  await db()
    .insert(resumeVersions)
    .values({ userId: user.id, version: saved.version, resume: masterResume })
    .onConflictDoNothing();

  enqueueRecalc(user.id); // fire-and-forget
  return c.json(saved);
});

profileRoutes.put("/references", zValidator("json", ReferenceListSchema), async (c) => {
  const user = c.get("user");
  const referenceList = c.req.valid("json");
  const rows = await db()
    .insert(profiles)
    .values({ userId: user.id, referenceList, version: 1 })
    .onConflictDoUpdate({
      target: profiles.userId,
      set: { referenceList, updatedAt: new Date() },
    })
    .returning();
  return c.json(rows[0]);
});

// PDF export of the authenticated user's saved profile.
profileRoutes.get("/pdf", async (c) => {
  const user = c.get("user");
  const rows = await db().select().from(profiles).where(eq(profiles.userId, user.id));
  const resume = rows[0]?.masterResume;
  if (!resume) return c.json({ error: "no_master_resume" }, 404);

  const pdf = await renderResumePdf(resume);
  return c.body(pdf, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="resume-master.pdf"`,
  });
});
