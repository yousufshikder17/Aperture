import assert from "node:assert/strict";
import test from "node:test";
import { referencesFromForm } from "../src/app/builder/reference-data.js";

test("reference forms preserve all fields and omit removed rows without changing the resume", () => {
  const form = new FormData();
  form.append("references", "7");
  const expected = { name: "Test Person", relationship: "Manager", title: "Lead", company: "Example",
    seniority: "director", lastWorkedTogether: "2025-01-01", contact: "test@example.test", notes: "Synthetic" };
  for (const [key, value] of Object.entries(expected)) form.set("references.7." + key, value);
  form.set("references.3.name", "Removed");
  form.set("name", "Unrelated resume field");
  assert.deepEqual(referencesFromForm(form), { references: [expected] });
  form.set("references.7.notes", " ");
  form.set("references.7.contact", "");
  assert.equal(referencesFromForm(form).references[0]?.notes, null);
  assert.equal(referencesFromForm(form).references[0]?.contact, null);
  form.set("references.7.seniority", "invalid");
  assert.throws(() => referencesFromForm(form));
  assert.deepEqual(referencesFromForm(new FormData()), { references: [] });
});
