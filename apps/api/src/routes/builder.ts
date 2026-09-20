import { Hono } from "hono";
import { desc, eq } from "drizzle-orm";
import { db, improvementHistory, profiles, resumeVersions } from "@aperture/db";
import { extractResumeFromDocx, extractResumeFromPdf } from "@aperture/ai";
import { skillGapFrequency } from "@aperture/analytics";
import { MarketSuggestionSchema, VersionSummarySchema } from "@aperture/shared";

export const DEFAULT_MAX_RESUME_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export function maxResumeUploadBytes(env: Record<string, string | undefined> = process.env): number {
  const configured = env.MAX_RESUME_UPLOAD_BYTES;
  if (!configured) return DEFAULT_MAX_RESUME_UPLOAD_BYTES;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("MAX_RESUME_UPLOAD_BYTES must be a positive integer");
  }
  return parsed;
}

export interface BuilderRouteDependencies {
  extractPdf?: typeof extractResumeFromPdf;
  extractDocx?: typeof extractResumeFromDocx;
  env?: Record<string, string | undefined>;
  loadProfile?: (userId: string) => Promise<typeof profiles.$inferSelect | null>;
  loadGaps?: typeof skillGapFrequency;
  loadVersions?: (userId: string) => Promise<Array<typeof resumeVersions.$inferSelect>>;
  loadScores?: (userId: string) => Promise<Array<typeof improvementHistory.$inferSelect>>;
}

export function createBuilderRoutes(dependencies: BuilderRouteDependencies = {}) {
  const builderRoutes = new Hono();
  const extractPdf = dependencies.extractPdf ?? extractResumeFromPdf;
  const extractDocx = dependencies.extractDocx ?? extractResumeFromDocx;
  const uploadLimit = maxResumeUploadBytes(dependencies.env);
  const findProfile = dependencies.loadProfile ?? (async (userId: string) =>
    (await db().select().from(profiles).where(eq(profiles.userId, userId)))[0] ?? null);
  const findGaps = dependencies.loadGaps ?? skillGapFrequency;
  const findVersions = dependencies.loadVersions ?? (async (userId: string) =>
    db().select().from(resumeVersions).where(eq(resumeVersions.userId, userId)).orderBy(desc(resumeVersions.version)));
  const findScores = dependencies.loadScores ?? (async (userId: string) =>
    db().select().from(improvementHistory).where(eq(improvementHistory.userId, userId)));
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  builderRoutes.post("/upload", async (c) => {
    const declaredLength = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > uploadLimit + MAX_MULTIPART_OVERHEAD_BYTES) {
      return c.json({ error: "payload_too_large", maxBytes: uploadLimit }, 413);
    }
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "expected multipart field 'file'" }, 400);
    if (file.size > uploadLimit) return c.json({ error: "payload_too_large", maxBytes: uploadLimit }, 413);

    const buffer = Buffer.from(await file.arrayBuffer());
    if (file.type === "application/pdf") return c.json(await extractPdf(buffer));
    if (file.type === docxMime || file.name.toLowerCase().endsWith(".docx")) {
      return c.json(await extractDocx(buffer));
    }
    return c.json({ error: "expected a PDF or DOCX" }, 400);
  });

  builderRoutes.get("/market-suggestions", async (c) => {
    const user = c.get("user");
    const gaps = await findGaps(user.id);
    const profile = await findProfile(user.id);
    const targetRoles = new Set((profile?.masterResume?.targetRoles ?? []).map((role) => role.trim().toLowerCase()));
    const relevant = targetRoles.size === 0 ? gaps : gaps.filter((gap) => targetRoles.has(String(gap.role_type ?? "").toLowerCase()));
    return c.json(MarketSuggestionSchema.array().parse(relevant));
  });

  builderRoutes.get("/versions", async (c) => {
    const user = c.get("user");
    const [versions, history] = await Promise.all([
      findVersions(user.id),
      findScores(user.id),
    ]);
    const scoresByVersion = new Map([...history]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((entry) => [entry.profileVersion, entry]));
    return c.json(versions.map((version) => {
      const scores = scoresByVersion.get(version.version);
      return VersionSummarySchema.parse({
        version: version.version,
        note: version.note,
        createdAt: version.createdAt.toISOString(),
        profileStrength: scores?.profileStrength ?? null,
        avgMatchScore: scores?.avgMatchScore ?? null,
        avgAtsScore: scores?.avgAtsScore ?? null,
      });
    }));
  });

  return builderRoutes;
}

export const builderRoutes = createBuilderRoutes();
