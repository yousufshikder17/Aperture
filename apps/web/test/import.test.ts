import assert from "node:assert/strict";
import test from "node:test";
import { importBody, IMPORT_LIMIT, parseExtraction } from "../src/app/builder/import-data.js";
import { emptyResume } from "../src/app/builder/form-data.js";

test("import accepts PDF and DOCX, normalizes missing MIME, and rejects unsafe or oversized selections", () => {
  for (const name of ["resume.pdf", "RESUME.DOCX"]) {
    const result = importBody(new File(["synthetic"], name));
    assert.ok((result.get("file") as File).type.startsWith("application/"));
  }
  for (const file of [new File([], "empty.pdf"), new File(["x"], "resume.exe"),
    new File(["x"], "resume.pdf", { type: "text/html" }),
    new File([new Uint8Array(IMPORT_LIMIT + 1)], "large.pdf")])
    assert.throws(() => importBody(file));
});
test("untrusted extraction must include a complete resume and valid layout findings", () => {
  const value = { resume: emptyResume(), layoutFindings: [{ issue: "Columns", atsRisk: "high", fix: "Use one column" }] };
  assert.deepEqual(parseExtraction(value), value);
  assert.throws(() => parseExtraction({ resume: {}, layoutFindings: [] }));
  assert.throws(() => parseExtraction({ ...value, layoutFindings: [{ issue: "x", atsRisk: "unknown", fix: "x" }] }));
  assert.deepEqual(emptyResume().basics.name, "");
});
