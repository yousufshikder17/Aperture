import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ResourcesView } from "../src/app/resources/view.js";

test("resource filtering preserves skill, validates levels, and distinguishes empty from failure", () => {
  const rows = ["beginner", "advanced"].map(level => ({ id: level, title: level + " course", level,
    url: "https://example.test", kind: "course", skills: ["C++"], timeCommitment: null, summary: null, complexityFlag: null }));
  const render = (level: string, error: string | null = null) => renderToStaticMarkup(
    React.createElement(ResourcesView, { rows, skill: "C++", level, error }));
  assert.match(render("beginner"), /beginner course/); assert.doesNotMatch(render("beginner"), /advanced course/);
  assert.ok(render("beginner").includes('name="skill" value="C++"'));
  assert.match(render("intermediate"), /No resources match/);
  assert.match(render("", "Unavailable"), /role="alert"/);
  assert.doesNotMatch(render("intermediate", "Unavailable"), /No resources match/);
  assert.match(render("invalid"), /advanced course/);
  assert.match(render("invalid"), /beginner course/);
});

