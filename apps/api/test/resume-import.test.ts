import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { Hono } from "hono";
import { ResumeExtractionSchema, ResumeImportResultSchema } from "@aperture/shared";
import { extractResumeFromDocx, extractResumeFromPdf, ResumeImportError, resumeImportCapabilities,
  OllamaProvider, type AIProvider, type StructuredRequest } from "@aperture/ai";
import { parseResumeText } from "../../../packages/ai/src/resume-parser.js";
import { renderResumePdf } from "../../../packages/ai/src/resume-pdf.js";
import { createBuilderRoutes } from "../src/routes/builder.js";

const text = await readFile(new URL("./fixtures/resume-import.txt", import.meta.url), "utf8");
async function docx(value = text) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  const paragraphs = value.split("\n").map(line => `<w:p><w:r><w:t xml:space="preserve">${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
async function textPdf() {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 850]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  text.split("\n").forEach((line, i) => page.drawText(line, { x: 30, y: 815 - i * 19, size: 10, font }));
  return Buffer.from(await document.save());
}
const textPdfFixture = await textPdf();
async function scannedPdf(mixed = false) {
  const [page] = await renderResumePdf(textPdfFixture, 1);
  const document = mixed ? await PDFDocument.load(textPdfFixture) : await PDFDocument.create();
  const image = await document.embedPng(page!);
  document.addPage([612, 850]).drawImage(image, { x: 0, y: 0, width: 612, height: 850 });
  return Buffer.from(await document.save());
}
function noProvider(t: TestContext) {
  const keys = ["FAST_PROVIDER", "AI_PROVIDER", "DEV_PROVIDER", "GEMINI_API_KEY", "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY", "OLLAMA_MODEL", "OLLAMA_MODEL_FAST", "OLLAMA_MODEL_QUALITY"];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  t.after(() => { for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; });
}
function fakeProvider(vision = false) {
  const calls: StructuredRequest<unknown>[] = [];
  const provider: AIProvider = { name: "fixture", modelLabel: () => "fixture:model", supportsImages: async () => vision,
    generate: async <T>(request: StructuredRequest<T>) => {
      calls.push(request);
      return request.schema.parse({ ...parseResumeText(text), layoutFindings: [{ issue: "Two columns", atsRisk: "high", fix: "Use one column" }] });
    }, generateMany: async () => new Map() };
  return { provider, calls };
}

test("DOCX deterministically structures common sections, preserves evidence, and never needs an AI provider", async t => {
  noProvider(t);
  t.mock.method(globalThis, "fetch", async () => { throw new Error("AI must not be called"); });
  const result = await extractResumeFromDocx(await docx());
  assert.equal(result.import?.method, "docx-text"); assert.equal(result.import?.aiUsed, false);
  assert.equal(result.resume.basics.name, "Alex Morgan"); assert.equal(result.resume.basics.email, "alex@example.test");
  assert.equal(result.resume.basics.location, "Toronto, Canada");
  assert.equal(result.resume.experience.length, 2);
  assert.equal(result.resume.experience[0]?.company, "Example Labs");
  assert.equal(result.resume.experience[0]?.title, "Software Engineer");
  assert.equal(result.resume.experience[0]?.start, "2022-01"); assert.equal(result.resume.experience[0]?.end, null);
  assert.equal(result.resume.experience[1]?.company, "Example Systems");
  assert.equal(result.resume.experience[1]?.end, "2021-12");
  assert.equal(result.resume.education[0]?.institution, "Example University");
  assert.equal(result.resume.education[0]?.field, "Computer Science");
  assert.equal(result.resume.education[0]?.start, "2016");
  assert.equal(result.resume.projects[0]?.name, "Resume Reader");
  assert.deepEqual(result.resume.skills.map(skill => skill.name), ["TypeScript", "Python", "C++", "Java", "Git", "Docker"]);
  assert.ok(result.resume.skills.every(skill => skill.level === null && skill.evidence.length === 0));
  assert.deepEqual(result.resume.targetRoles, []); assert.match(result.import!.rawText!, /List<T>/);
  assert.equal(ResumeExtractionSchema.safeParse(result).success, true);
  assert.equal(ResumeImportResultSchema.safeParse(result).success, true);
});
test("PDF text layers use the same deterministic parser without rendering or AI, including auto mode", async t => {
  noProvider(t);
  const fake = fakeProvider(true);
  for (const mode of ["deterministic", "auto"] as const) {
    const result = await extractResumeFromPdf(textPdfFixture, { mode, provider: fake.provider });
    assert.equal(result.import?.method, "pdf-text"); assert.equal(result.import?.aiUsed, false);
    assert.equal(result.resume.basics.name, "Alex Morgan"); assert.equal(result.resume.experience.length, 2);
    assert.match(result.import!.rawText!, /List<T>/);
    assert.equal(result.layoutFindings.length, 0);
  }
  assert.equal(fake.calls.length, 0);
});
test("ambiguous text remains evidence without invented employers, credentials, dates or visual findings", async () => {
  const raw = "Unknown Format\nconstructor\nExperience\nUnclear Company Role\nEducation\nUnclear Course\nSkills\nRust; SQL\n<script>literal</script>";
  const result = await extractResumeFromDocx(await docx(raw));
  assert.deepEqual(result.resume.experience, []); assert.deepEqual(result.resume.education, []);
  assert.match(result.import!.rawText!, /Unclear Company Role/);
  assert.match(result.import!.rawText!, /<script>literal<\/script>/);
  assert.ok(result.layoutFindings.every(finding => !/column|font|table/i.test(finding.issue)));
});
test("scanned and mixed PDFs without configured AI provide actionable errors instead of silently losing pages", async t => {
  noProvider(t);
  assert.deepEqual(await resumeImportCapabilities(), { aiAvailable: false, visionAvailable: false });
  for (const mixed of [false, true]) {
    const file = await scannedPdf(mixed);
    await assert.rejects(extractResumeFromPdf(file), error => error instanceof ResumeImportError && error.code === "resume_text_unusable" && /vision-capable|text-based/.test(error.message));
    await assert.rejects(extractResumeFromPdf(file, { mode: "auto" }), error => error instanceof ResumeImportError && error.code === "ai_unavailable");
  }
});
test("auto fallback renders actual pages only for a confirmed vision provider and validates its draft", async () => {
  const fake = fakeProvider(true);
  const result = await extractResumeFromPdf(await scannedPdf(), { mode: "auto", provider: fake.provider });
  assert.equal(result.import?.method, "ai-vision"); assert.equal(result.import?.aiUsed, true);
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0]!.content.some(part => part.type === "image" && Buffer.from(part.data, "base64").length > 1000));
  assert.equal(result.layoutFindings[0]?.issue, "Two columns");
  assert.equal(ResumeImportResultSchema.safeParse(result).success, true);
});
test("AI-assisted DOCX and text-only PDF use text; model-invented visual findings are discarded", async () => {
  const fake = fakeProvider(false);
  for (const result of [await extractResumeFromDocx(await docx(), { mode: "ai-assisted", provider: fake.provider }),
    await extractResumeFromPdf(textPdfFixture, { mode: "ai-assisted", provider: fake.provider })]) {
    assert.equal(result.import?.method, "ai-text"); assert.equal(result.import?.aiUsed, true);
    assert.deepEqual(result.layoutFindings, []);
  }
  assert.ok(fake.calls.every(call => call.content.every(part => part.type === "text")));
  await assert.rejects(extractResumeFromPdf(await scannedPdf(), { mode: "ai-assisted", provider: fake.provider }),
    error => error instanceof ResumeImportError && error.code === "vision_required");
  assert.equal(fake.calls.length, 2);
});
test("AI-assisted text PDFs inspect all rendered pages when vision is supported", async () => {
  const fake = fakeProvider(true);
  const result = await extractResumeFromPdf(textPdfFixture, { mode: "ai-assisted", provider: fake.provider });
  assert.equal(result.import?.method, "ai-vision");
  assert.match(result.import!.rawText!, /Alex Morgan/);
  assert.equal(fake.calls[0]?.content.filter(part => part.type === "image").length, 1);
});
test("unrecognized experience boundaries do not attach another employer's bullets to a parsed role", () => {
  const result = parseResumeText("Alex Morgan\nExperience\nDeveloper at Example\n2020 - 2021\n- Built a tool.\nUnclear Header\n2022 - Present\n- Work at an uncertain employer.");
  assert.equal(result.resume.experience.length, 1);
  assert.deepEqual(result.resume.experience[0]?.bullets, ["Built a tool."]);
  assert.match(result.layoutFindings[0]!.issue, /Some experience/);
});
test("PDF page and render bounds reject oversized inputs before any AI generation", async () => {
  const fake = fakeProvider(true);
  const many = await PDFDocument.create();
  for (let i = 0; i < 21; i++) many.addPage();
  await assert.rejects(extractResumeFromPdf(Buffer.from(await many.save()), { mode: "auto", provider: fake.provider }),
    error => error instanceof ResumeImportError && error.code === "resume_import_limit");
  const huge = await PDFDocument.create(); huge.addPage([10000, 10000]);
  await assert.rejects(extractResumeFromPdf(Buffer.from(await huge.save()), { mode: "auto", provider: fake.provider }),
    error => error instanceof ResumeImportError && error.code === "resume_import_limit");
  assert.equal(fake.calls.length, 0);
});
test("Ollama text-only structuring uses the existing adapter and schema without sending images", async t => {
  noProvider(t); process.env.FAST_PROVIDER = "ollama"; process.env.OLLAMA_MODEL = "fixture-text-model";
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls.push(input);
    if (input.endsWith("/api/show")) return Response.json({ capabilities: ["completion"] });
    if (input.endsWith("/api/tags")) return Response.json({ models: [] });
    assert.ok(input.endsWith("/api/chat"));
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "fixture-text-model"); assert.equal(body.stream, false); assert.ok(body.format.properties.resume);
    assert.ok(body.messages.every((message: { images?: unknown }) => !message.images));
    return Response.json({ message: { content: JSON.stringify(parseResumeText(text)) } });
  });
  assert.deepEqual(await resumeImportCapabilities(), { aiAvailable: true, visionAvailable: false });
  const result = await extractResumeFromDocx(await docx(), { mode: "ai-assisted" });
  assert.equal(result.import?.method, "ai-text"); assert.equal(result.resume.basics.name, "Alex Morgan");
  await assert.rejects(extractResumeFromPdf(await scannedPdf(), { mode: "auto" }), error => error instanceof ResumeImportError && error.code === "vision_required");
  assert.equal(calls.filter(url => url.endsWith("/api/chat")).length, 1);
});
test("Ollama vision capability is explicit; missing, malformed and unavailable model metadata fail closed", async t => {
  noProvider(t); process.env.OLLAMA_MODEL = "fixture-model";
  let response = Response.json({ capabilities: ["completion", "vision"] });
  t.mock.method(globalThis, "fetch", async () => response);
  const provider = new OllamaProvider();
  assert.equal(await provider.supportsImages("fast"), true);
  for (const value of [{ capabilities: ["completion"] }, {}, { capabilities: "vision" }]) {
    response = Response.json(value); assert.equal(await provider.supportsImages("fast"), false);
  }
  response = new Response("unavailable", { status: 503 }); assert.equal(await provider.supportsImages("fast"), false);
});
test("invalid files, empty DOCX and oversized text fail safely without raw provider diagnostics", async () => {
  for (const extract of [extractResumeFromDocx, extractResumeFromPdf])
    await assert.rejects(extract(Buffer.from("not a document")), error => error instanceof ResumeImportError && error.code === "invalid_resume_document");
  await assert.rejects(extractResumeFromDocx(await docx("")), error => error instanceof ResumeImportError && error.code === "resume_text_unusable");
  await assert.rejects(extractResumeFromDocx(await docx("a".repeat(200001))), error => error instanceof ResumeImportError && error.code === "resume_import_limit");
  const fake = fakeProvider(); fake.provider.generate = async () => { throw new Error("secret provider response containing resume text"); };
  await assert.rejects(extractResumeFromDocx(await docx(), { mode: "ai-assisted", provider: fake.provider }),
    error => error instanceof ResumeImportError && error.code === "ai_import_failed" && !/secret/.test(error.message));
});
test("upload defaults to deterministic, validates modes, reports safe failures and never loads/saves a profile", async () => {
  let calls = 0;
  const app = new Hono().route("/builder", createBuilderRoutes({
    loadVersions: async () => { throw new Error("Import must not access saved profile"); },
    extractDocx: async (file, options) => { calls++; assert.equal(options?.mode, "deterministic"); return extractResumeFromDocx(file, options); },
    importCapabilities: async () => ({ aiAvailable: false, visionAvailable: false }),
  }));
  const form = new FormData(); form.set("file", new File([await docx()], "resume.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }));
  const result = await app.request("/builder/upload", { method: "POST", body: form });
  assert.equal(result.status, 200); assert.equal((await result.json()).import.aiUsed, false);
  form.set("mode", "invalid");
  assert.equal((await app.request("/builder/upload", { method: "POST", body: form })).status, 400);
  assert.equal(calls, 1);
  assert.deepEqual(await (await app.request("/builder/import-capabilities")).json(), { aiAvailable: false, visionAvailable: false });
  const errors = new Hono().route("/builder", createBuilderRoutes({ extractPdf: async () => {
    throw new ResumeImportError("vision_required", "Use OCR or a vision-capable model");
  } }));
  const pdf = new FormData(); pdf.set("file", new File([textPdfFixture], "resume.pdf", { type: "application/pdf" }));
  const error = await errors.request("/builder/upload", { method: "POST", body: pdf });
  assert.equal(error.status, 422); assert.equal((await error.json()).error, "vision_required");
});
