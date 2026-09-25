import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { GapAnalysisView } from "../src/app/gap-analysis/view.js";
import Loading from "../src/app/gap-analysis/loading.js";

test("gap view renders role totals, escaped skills, empty and error states", () => {
  const render = (gaps: Parameters<typeof GapAnalysisView>[0]["gaps"], error = "") =>
    renderToStaticMarkup(React.createElement(GapAnalysisView, { gaps, error }));
  assert.match(render([]), /Score listings first/);
  assert.match(render([], "Sign in through Account"), /role="alert"/);
  assert.doesNotMatch(render([], "Unavailable"), /No skill gaps yet/);
  const html = render([{ skill: "<script>", role_type: "Engineer", listings_requiring: 1, listings_total: 2, frequency_pct: 50 }]);
  assert.ok(html.includes("1/2 listings")); assert.match(html, /50%/); assert.match(html, /&lt;script&gt;/);
  assert.ok(readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8").includes('href="/gap-analysis"'));
});

test("gap loading state is announced", () => {
  assert.match(renderToStaticMarkup(React.createElement(Loading)), /role="status"/);
});
