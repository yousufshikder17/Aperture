import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { FeedScanSchema, ListingRowSchema, MatchScoreSchema } from "@aperture/shared";
import { ApiError, UpgradeRequiredError } from "../src/lib/api.js";
import { listingError, safeListingUrl, scanSummary } from "../src/app/listings/listing-data.js";
import { MatchReport } from "../src/app/listings/listing-report.js";

test("public listing links reject executable URLs and report rendering escapes provider text", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,bad", "/local", "bad"])
    assert.equal(safeListingUrl(value), null);
  assert.equal(safeListingUrl("https://example.test/job"), "https://example.test/job");
  const score = MatchScoreSchema.parse({ overall: 0, subscores: { skills: 0, experience: 0, seniority: 0, location: 0 },
    strengths: [], concerns: ["<script>bad()</script>"], verdict: "skip", rationale: "Synthetic" });
  const html = renderToStaticMarkup(React.createElement(MatchReport, { score, version: 2 }));
  assert.match(html, /0.0 \/ 100/);
  assert.match(html, /resume version 2/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(ListingRowSchema.safeParse({ listing: {}, match: score, profileVersion: "2" }).success, false);
});
test("scan messages distinguish missing configuration, outage, partial failure and duplicates", () => {
  const base = { configured: 0, succeeded: 0, inserted: 0, scanned: 0, failedSources: [] };
  assert.match(scanSummary(base), /No feeds are configured/);
  assert.match(scanSummary({ ...base, configured: 1, failedSources: ["indeed_rss"] }), /No configured feeds could be read/);
  assert.match(scanSummary({ ...base, configured: 2, succeeded: 1, failedSources: ["indeed_rss"] }), /Some feeds failed/);
  assert.match(scanSummary({ ...base, configured: 1, succeeded: 1, scanned: 5 }), /0 new listings added from 5/);
  assert.equal(FeedScanSchema.safeParse({ ...base, scanned: "0" }).success, false);
});
test("public errors explain admin, sign-in, profile and quota recovery without exposing server details", () => {
  assert.match(listingError(new ApiError(401)), /Sign in/);
  assert.match(listingError(new ApiError(403)), /administrator/);
  assert.match(listingError(new ApiError(409)), /Save a master resume/);
  assert.match(listingError(new UpgradeRequiredError("secret")), /allowance/);
  assert.doesNotMatch(listingError(new Error("secret")), /secret/);
});
test("public workflow source has no private API calls or private report contracts", () => {
  for (const file of ["listing-workflow.tsx", "listing-data.ts", "listing-report.tsx"]) {
    const source = readFileSync(new URL("../src/app/listings/" + file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\/intel|\/tailor|TailoredResume|RecruiterIntel|fetchTailoredPdf/);
  }
});
