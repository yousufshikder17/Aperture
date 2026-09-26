import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApplicationForm } from "../src/app/applications/application-form.js";
import ApplicationTracker from "../src/app/applications/application-tracker.js";
import { applicationError } from "../src/app/applications/application-data.js";
import { ApiError } from "../src/lib/api.js";

test("application forms label fields, preserve saved notes, escape content and disable unchanged saves", () => {
  const row = { id: "00000000-0000-4000-8000-000000000001", listingId: "00000000-0000-4000-8000-000000000002",
    status: "applied" as const, notes: "<script>example</script>", appliedAt: null, createdAt: "2026-09-26", events: [],
    listing: { title: "Engineer", company: "Example" } };
  const html = renderToStaticMarkup(React.createElement(ApplicationForm, { application: row, onSaved() {} }));
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>/);
  assert.match(html, /disabled="">Save changes/); assert.match(html, /maxLength="10000"/);
  for (const status of ["Saved", "Applied", "Screening", "Interviewing", "Offer", "Rejected", "Withdrawn"]) assert(html.includes(status));
  const create = renderToStaticMarkup(React.createElement(ApplicationForm, { listings: [], onSaved() {} }));
  assert.match(create, /Choose a listing/); assert.match(create, /disabled="">Log application/);
  assert.match(renderToStaticMarkup(React.createElement(ApplicationTracker)), /Loading tracker/);
});

test("tracker errors distinguish sign-in, missing records and retryable failures", () => {
  assert.match(applicationError(new ApiError(401)), /Sign in/);
  assert.match(applicationError(new ApiError(404)), /no longer available/);
  assert.match(applicationError(new ApiError(400)), /Check/);
  assert.match(applicationError(new Error("database secret")), /retry/);
  assert.doesNotMatch(applicationError(new Error("database secret")), /secret/);
});
