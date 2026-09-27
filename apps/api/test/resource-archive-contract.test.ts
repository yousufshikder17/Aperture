import assert from "node:assert/strict";
import test from "node:test";
import { ArchiveSaveSchema, ArchivePatchSchema, ProgressSchema } from "@aperture/shared";

test("archive validation permits notes clearing and each progress state, rejects empty/oversized/invalid changes", () => {
  for (const progress of ProgressSchema.options) assert.equal(ArchivePatchSchema.parse({ progress }).progress, progress);
  assert.deepEqual(ArchivePatchSchema.parse({ notes: "", userId: "spoofed" }), { notes: "" });
  for (const input of [{}, { progress: "done" }, { notes: "x".repeat(10001) }, { userId: "spoofed" }])
    assert.equal(ArchivePatchSchema.safeParse(input).success, false);
  for (const resourceId of ["", "   ", "x".repeat(201)])
    assert.equal(ArchiveSaveSchema.safeParse({ resourceId }).success, false);
  assert.equal(ArchiveSaveSchema.parse({ resourceId: " resource " }).resourceId, "resource");
});
