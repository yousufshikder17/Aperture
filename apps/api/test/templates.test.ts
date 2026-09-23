import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { PDFDocument } from "pdf-lib";
import { DEFAULT_TEMPLATE, TemplateSchema, type MasterResume, type ResumeTemplate } from "@aperture/shared";
import { renderResumePdf } from "../src/lib/pdf-export.js";
import { createTemplateRoutes } from "../src/routes/templates.js";

const userId = "00000000-0000-4000-8000-000000000001";
const resume: MasterResume = {
  basics: { name: "Test Candidate", email: "test@example.test", phone: null,
    location: "Toronto", headline: null, links: [] },
  summary: "A concise summary.",
  experience: [{ company: "Example", title: "Engineer", start: "2020", end: null,
    location: null, bullets: ["Built a useful thing."], skills: [] }],
  projects: [], education: [], skills: [{ name: "TypeScript", category: "Languages", level: null, evidence: [] }],
  certifications: [], publications: [], awards: [], targetRoles: ["Engineer"],
};

test("public catalog, selection, and preview stay scoped to the signed-in user", async () => {
  let selected: ResumeTemplate | null = null;
  let master: MasterResume | null = resume;
  const calls: string[] = [];
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: userId }); await next(); });
  app.route("/templates", createTemplateRoutes({
    loadProfile: async (id) => { calls.push(id); return { userId: id, masterResume: master,
      template: selected, version: 1, referenceList: null, updatedAt: new Date() }; },
    saveTemplate: async (id, template) => { calls.push(id); selected = template; },
  }));

  const search = await app.request("/templates/library?q=technical");
  assert.equal(search.status, 200);
  assert.deepEqual((await search.json() as ResumeTemplate[]).map((item) => item.id), ["technical-sidebar"]);
  assert.equal((await app.request("/templates/extract", { method: "POST" })).status, 404);

  const style = TemplateSchema.parse({ ...DEFAULT_TEMPLATE, color: { ...DEFAULT_TEMPLATE.color, accent: "#334455" },
    atsCompatibility: { score: 1, warnings: ["forged"] } });
  assert.equal((await app.request("/templates/active?userId=attacker", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(style),
  })).status, 200);
  assert.equal(selected?.atsCompatibility.score, 100);
  assert.equal((await app.request("/templates/active")).status, 200);

  const preview = await app.request("/templates/preview", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(style) });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "application/pdf");
  assert.equal(Buffer.from(await preview.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  master = null;
  assert.equal((await app.request("/templates/preview", { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify(style) })).status, 409);
  assert.ok(calls.every((id) => id === userId));
});

test("public PDF renderer applies the selected template and paginates long content", async () => {
  const twoColumn = TemplateSchema.parse({ ...DEFAULT_TEMPLATE,
    layout: { ...DEFAULT_TEMPLATE.layout, columns: 2, sidebar: ["skills"] } });
  const expanded = { ...resume, experience: [{ ...resume.experience[0]!, bullets: Array(130).fill("Built a useful thing.") }] };
  const classic = await renderResumePdf(expanded);
  const selected = await renderResumePdf(expanded, twoColumn);
  assert.notDeepEqual(classic, selected);
  assert.ok((await PDFDocument.load(selected)).getPageCount() > 1);
});
