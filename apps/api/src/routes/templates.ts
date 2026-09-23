import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { db, profiles } from "@aperture/db";
import { assessTemplate, DEFAULT_TEMPLATE, TemplateSchema, type ResumeTemplate } from "@aperture/shared";
import { renderResumePdf } from "../lib/pdf-export.js";

// Curated catalog released with this public repository.
const library = TemplateSchema.array().parse(JSON.parse(readFileSync(
  new URL("../../../../resources/templates.json", import.meta.url), "utf8",
)));

async function loadProfile(userId: string) {
  return (await db().select().from(profiles).where(eq(profiles.userId, userId)))[0] ?? null;
}

async function saveTemplate(userId: string, template: ResumeTemplate) {
  await db().insert(profiles).values({ userId, template }).onConflictDoUpdate({
    target: profiles.userId, set: { template, updatedAt: new Date() },
  });
}

export function createTemplateRoutes(dependencies: {
  loadProfile?: typeof loadProfile;
  saveTemplate?: typeof saveTemplate;
  renderPdf?: typeof renderResumePdf;
} = {}) {
  const routes = new Hono();
  const findProfile = dependencies.loadProfile ?? loadProfile;
  const save = dependencies.saveTemplate ?? saveTemplate;

  routes.get("/library", (c) => {
    const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, 100);
    return c.json(library.filter((template) =>
      !q || [template.name, ...template.tags, ...template.bestFor,
        template.layout.columns === 2 ? "two column" : "single column",
        template.atsCompatibility.score === 100 ? "ATS safe" : "ATS warning"]
        .some((value) => value.toLowerCase().includes(q))));
  });

  routes.get("/active", async (c) => {
    const profile = await findProfile(c.get("user").id);
    return c.json({ template: profile?.template ?? DEFAULT_TEMPLATE, saved: !!profile?.template });
  });

  routes.put("/active", zValidator("json", TemplateSchema), async (c) => {
    const template = assessTemplate(c.req.valid("json"));
    await save(c.get("user").id, template);
    return c.json(template);
  });

  routes.post("/preview", zValidator("json", TemplateSchema), async (c) => {
    const profile = await findProfile(c.get("user").id);
    if (!profile?.masterResume) return c.json({ error: "no_master_resume" }, 409);
    const pdf = await (dependencies.renderPdf ?? renderResumePdf)(profile.masterResume,
      assessTemplate(c.req.valid("json")));
    return c.body(pdf, 200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
  });
  return routes;
}

export const templateRoutes = createTemplateRoutes();
