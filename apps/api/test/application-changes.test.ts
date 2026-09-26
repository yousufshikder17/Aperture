import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationCreateSchema, ApplicationPatchSchema } from "@aperture/shared";
import { applicationChanges } from "../src/lib/application-changes.js";

test("notes-only and unchanged status edits preserve history and first applied date", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  const current = { status: "saved", appliedAt: null, events: [{ status: "saved", at: now.toISOString() }] };
  assert.deepEqual(applicationChanges(current, { notes: "" }, now).events, current.events);
  assert.deepEqual(applicationChanges(current, { status: "saved" }, now).events, current.events);
  for (const status of ["applied", "screening", "interviewing", "offer"] as const) {
    const update = applicationChanges(current, { status }, now);
    assert.equal(update.appliedAt, now); assert.equal(update.events.length, 2);
  }
  const applied = { ...current, status: "applied", appliedAt: now };
  assert.equal(applicationChanges(applied, { status: "rejected" }, new Date()).appliedAt, now);
  assert.equal(applicationChanges(current, { status: "withdrawn" }, now).appliedAt, null);
  assert.equal(current.events.length, 1);
});

test("application requests reject invalid IDs, statuses, empty edits, and oversized notes", () => {
  assert(!ApplicationCreateSchema.safeParse({ listingId: "bad" }).success);
  assert(!ApplicationPatchSchema.safeParse({ status: "unknown" }).success);
  assert(!ApplicationPatchSchema.safeParse({}).success);
  assert(!ApplicationPatchSchema.safeParse({ userId: "someone" }).success);
  assert(!ApplicationPatchSchema.safeParse({ notes: "x".repeat(10001) }).success);
  assert.deepEqual(ApplicationPatchSchema.parse({ notes: "", userId: "someone" }), { notes: "" });
});
