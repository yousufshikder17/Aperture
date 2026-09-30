import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { PDFDocument } from "pdf-lib";
import { extractPosting } from "@aperture/ai";
import { ManualListingCreateSchema } from "@aperture/shared";
import { createManualListing } from "../services/listing-storage.js";
import { consumeQuota } from "../middleware/tier.js";

const MAX_UPLOAD = 4 * 1024 * 1024;
export function createManualListingRoutes(dependencies: {
  save?: typeof createManualListing; extract?: typeof extractPosting; quota?: typeof consumeQuota;
} = {}) {
  const routes = new Hono<{ Variables: { postingFile: Buffer; postingFormat: "txt" | "docx" | "pdf"; postingMethod: "text" | "ai" } }>();
  routes.post("/manual", bodyLimit({ maxSize: 256 * 1024 }),
    zValidator("json", ManualListingCreateSchema), async c => {
      const row = await (dependencies.save ?? createManualListing)(c.get("user").id, c.req.valid("json"));
      return row ? c.json(row, 201) : c.json({ error: "posting_retry_conflict" }, 409);
    });
  routes.post("/import", bodyLimit({ maxSize: MAX_UPLOAD + 64 * 1024 }), async (c, next) => {
    let body;
    try { body = await c.req.parseBody(); }
    catch { return c.json({ error: "invalid_upload" }, 400); }
    const file = body.file;
    if (!(file instanceof File) || !file.size) return c.json({ error: "file_required" }, 400);
    if (file.size > MAX_UPLOAD) return c.json({ error: "payload_too_large" }, 413);
    const format = file.name.toLowerCase().split(".").pop();
    if (format !== "txt" && format !== "docx" && format !== "pdf")
      return c.json({ error: "expected_txt_docx_or_pdf" }, 415);
    const method = body.method ?? "text";
    if ((method !== "text" && method !== "ai") || (method === "ai" && format !== "pdf"))
      return c.json({ error: "invalid_extraction_method" }, 400);
    c.set("postingMethod", method);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (format === "pdf") {
      try {
        const pdf = await PDFDocument.load(buffer);
        if (pdf.getPageCount() > 5) return c.json({ error: "maximum_five_pages" }, 400);
      } catch { return c.json({ error: "invalid_pdf" }, 400); }
    }
    c.set("postingFile", buffer); c.set("postingFormat", format);
    await next();
  }, async (c, next) => {
    // Only explicit AI extraction reserves quota; local quality warnings never trigger AI spend.
    if (c.get("postingMethod") === "ai") return (dependencies.quota ?? consumeQuota)("matches")(c, next);
    await next();
  }, async c => {
    try { return c.json(await (dependencies.extract ?? extractPosting)(c.get("postingFile"), c.get("postingFormat"), c.get("postingMethod"))); }
    catch { return c.json({ error: "posting_extraction_failed" }, 422); }
  });
  return routes;
}
