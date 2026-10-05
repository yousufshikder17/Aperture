import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { desc, eq } from "drizzle-orm";
import { db, improvementHistory, resumeVersions } from "@aperture/db";
import { extractResumeFromDocx, extractResumeFromPdf, resumeImportCapabilities, ResumeImportError } from "@aperture/ai";
import { loadSkillGaps } from "../services/gap-analysis.js";
import { MarketSuggestionSchema, VersionSummarySchema, ResumeImportModeSchema } from "@aperture/shared";

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
  importCapabilities?: typeof resumeImportCapabilities;
  env?: Record<string, string | undefined>;
  loadGaps?: typeof loadSkillGaps;
  loadVersions?: (userId: string) => Promise<Array<typeof resumeVersions.$inferSelect>>;
  loadScores?: (userId: string) => Promise<Array<typeof improvementHistory.$inferSelect>>;
}

export function createBuilderRoutes(dependencies: BuilderRouteDependencies = {}) {
  const builderRoutes = new Hono();
  const extractPdf = dependencies.extractPdf ?? extractResumeFromPdf;
  const extractDocx = dependencies.extractDocx ?? extractResumeFromDocx;
  const uploadLimit = maxResumeUploadBytes(dependencies.env);
  const findGaps = dependencies.loadGaps ?? loadSkillGaps;
  const findVersions = dependencies.loadVersions ?? (async (userId: string) =>
    db().select().from(resumeVersions).where(eq(resumeVersions.userId, userId)).orderBy(desc(resumeVersions.version)));
  const findScores = dependencies.loadScores ?? (async (userId: string) =>
    db().select().from(improvementHistory).where(eq(improvementHistory.userId, userId)));
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  builderRoutes.get("/import-capabilities", async c => c.json(await (dependencies.importCapabilities ?? resumeImportCapabilities)()));

  builderRoutes.post("/upload", bodyLimit({
    maxSize: uploadLimit + MAX_MULTIPART_OVERHEAD_BYTES,
    onError: c => c.json({ error: "payload_too_large", maxBytes: uploadLimit }, 413),
  }), async (c) => {
    const declaredLength = Number(c.req.header("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > uploadLimit + MAX_MULTIPART_OVERHEAD_BYTES) {
      return c.json({ error: "payload_too_large", maxBytes: uploadLimit }, 413);
    }
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "expected multipart field 'file'" }, 400);
    if (file.size > uploadLimit) return c.json({ error: "payload_too_large", maxBytes: uploadLimit }, 413);

    const mode = ResumeImportModeSchema.safeParse(body["mode"] ?? "deterministic");
    if (!mode.success) return c.json({ error: "invalid_import_mode" }, 400);
    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      if (file.type === "application/pdf") return c.json(await extractPdf(buffer, { mode: mode.data }));
      if (file.type === docxMime || file.name.toLowerCase().endsWith(".docx")) {
        return c.json(await extractDocx(buffer, { mode: mode.data }));
      }
    } catch (error) {
      if (!(error instanceof ResumeImportError)) throw error;
      const status = error.code === "resume_import_limit" ? 413 : error.code === "ai_unavailable" || error.code === "ai_import_failed" ? 503 : 422;
      return c.json({ error: error.code, message: error.message }, status);
    }
    return c.json({ error: "expected a PDF or DOCX" }, 400);
  });

  builderRoutes.get("/market-suggestions", async (c) => {
    const user = c.get("user");
    const gaps = await findGaps(user.id);
    return c.json(MarketSuggestionSchema.array().parse(gaps));
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
