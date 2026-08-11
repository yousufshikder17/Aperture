import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db, profiles, resourceArchive, resources } from "@aperture/db";
import { consumeQuota } from "../middleware/tier.js";
import { requireAdmin } from "../middleware/authorization.js";
import { syncRegistry } from "../services/resource-sync.js";

export interface ResourceRouteDependencies {
  syncRegistry?: typeof syncRegistry;
}

export function createResourceRoutes(
  dependencies: ResourceRouteDependencies = {},
) {
  const resourceRoutes = new Hono();
  const runResourceSync = dependencies.syncRegistry ?? syncRegistry;

  // Directory read. Complexity tags were computed at index time (constraint #8),
  // so this is a pure DB lookup with prerequisite gating — no AI on the path.
  resourceRoutes.get("/", async (c) => {
    const user = c.get("user");
    const skill = c.req.query("skill");

    let rows = await db().select().from(resources);
    if (skill) {
      const target = skill.toLowerCase();
      rows = rows.filter((r) =>
        r.skills.some((s) => s.toLowerCase() === target),
      );
    }

    // Complexity filtering: don't surface advanced resources to beginners unless
    // prerequisites are met. User level is inferred from profile skills.
    const profileRows = await db()
      .select()
      .from(profiles)
      .where(eq(profiles.userId, user.id));
    const userSkills = new Set(
      (profileRows[0]?.masterResume?.skills ?? []).map((s) =>
        s.name.toLowerCase(),
      ),
    );

    const annotated = rows.map((r) => {
      const missingPrereqs = (r.prerequisites ?? []).filter(
        (p) => !userSkills.has(p.toLowerCase()),
      );
      const gated = r.level === "advanced" && missingPrereqs.length > 0;
      return {
        ...r,
        missingPrerequisites: missingPrereqs,
        complexityFlag: gated
          ? `Complete ${missingPrereqs.join(", ")} before attempting this`
          : null,
      };
    });

    // Gated resources sort last; their prerequisite resources surface first.
    annotated.sort(
      (a, b) =>
        Number(a.complexityFlag !== null) - Number(b.complexityFlag !== null),
    );
    return c.json(annotated);
  });

  // Pull the GitHub registry and batch-index new entries (also run by cron).
  resourceRoutes.post("/sync", requireAdmin(), async (c) => {
    const result = await runResourceSync();
    return c.json(result);
  });

  // ---- Personal archive: save + notes + progress ----

  resourceRoutes.get("/archive", async (c) => {
    const user = c.get("user");
    const rows = await db()
      .select()
      .from(resourceArchive)
      .innerJoin(resources, eq(resources.id, resourceArchive.resourceId))
      .where(eq(resourceArchive.userId, user.id));
    return c.json(
      rows.map((r) => ({ ...r.resource_archive, resource: r.resources })),
    );
  });

  // Free tier: 3 saves (checked in consumeQuota before the insert).
  resourceRoutes.post(
    "/archive",
    consumeQuota("saves"),
    zValidator(
      "json",
      z.object({ resourceId: z.string(), notes: z.string().optional() }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const rows = await db()
        .insert(resourceArchive)
        .values({
          userId: user.id,
          resourceId: body.resourceId,
          notes: body.notes,
        })
        .onConflictDoNothing()
        .returning();
      if (!rows[0]) return c.json({ error: "already_saved" }, 409);
      return c.json(rows[0], 201);
    },
  );

  resourceRoutes.patch(
    "/archive/:id",
    zValidator(
      "json",
      z.object({
        progress: z
          .enum(["not_started", "in_progress", "completed"])
          .optional(),
        notes: z.string().optional(),
      }),
    ),
    async (c) => {
      const user = c.get("user");
      const body = c.req.valid("json");
      const rows = await db()
        .update(resourceArchive)
        .set({ ...body, updatedAt: new Date() })
        .where(
          and(
            eq(resourceArchive.id, c.req.param("id")),
            eq(resourceArchive.userId, user.id),
          ),
        )
        .returning();
      if (!rows[0]) return c.json({ error: "not_found" }, 404);
      return c.json(rows[0]);
    },
  );

  return resourceRoutes;
}

export const resourceRoutes = createResourceRoutes();
