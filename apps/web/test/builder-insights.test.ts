import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import BuilderInsights, { formatScore } from "../src/app/builder/builder-insights.js";

test("version display distinguishes unavailable scores from zero", () => {
  assert.equal(formatScore(null), "Pending / unavailable");
  assert.equal(formatScore(undefined), "Pending / unavailable");
  assert.equal(formatScore(0), "0.0 / 100");
  assert.equal(formatScore(73.25), "73.3 / 100");
});

test("public builder insights expose market suggestions without hosted audit controls", () => {
  const html = renderToStaticMarkup(React.createElement(BuilderInsights));
  assert.match(html, /Market suggestions/);
  assert.match(html, /Load market suggestions/);
  assert.match(html, /not live market data/);
  assert.doesNotMatch(html, /audit|Audit|allowance|coaching/);
});
