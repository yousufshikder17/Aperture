import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArchiveEditor } from "../src/app/resources/archive-editor.js";
import { ResourcesView as ResourceDirectory } from "../src/app/resources/view.js";
import ResourceArchive from "../src/app/resources/archive-workflow.js";
import { ResourceDetails } from "../src/app/resources/resource-card.js";
import { archiveError } from "../src/app/resources/resource-data.js";
import { ApiError, UpgradeRequiredError } from "../src/lib/api.js";

const resource = { id: "sql", title: "SQL course", url: "https://example.test", kind: "course", skills: ["SQL"],
  level: "beginner", timeCommitment: "hours", summary: null };
test("directory preserves level/skill filters and never marks archive-load failure as empty", () => {
  const render = (level: string, error: string | null) => renderToStaticMarkup(React.createElement(ResourceDirectory, {
    rows: [resource], skill: "SQL", level, error,
  }));
  assert.match(render("beginner", null), /SQL course/);
  assert.doesNotMatch(render("advanced", null), /SQL course/);
  assert.match(render("beginner", null), /name="skill" value="SQL"/);
  assert.match(render("beginner", null), /disabled="">Save to archive/);
  assert.doesNotMatch(render("advanced", "Unavailable"), /No resources match/);
  const loading = renderToStaticMarkup(React.createElement(ResourceArchive));
  assert.match(loading, /Loading archive/); assert.doesNotMatch(loading, /No saved resources yet/);
});
test("archive editor escapes notes, labels progress, and disables unchanged saves; resource links are safe", () => {
  const entry = { id: "00000000-0000-4000-8000-000000000001", resourceId: "sql", progress: "not_started" as const,
    notes: "<script>notes</script>", savedAt: "2026-09-27", updatedAt: "2026-09-27", resource };
  const html = renderToStaticMarkup(React.createElement(ArchiveEditor, { entry, onSaved() {} }));
  assert.match(html, /&lt;script&gt;/); assert.match(html, /disabled="">Save changes/);
  for (const value of ["Not started", "In progress", "Completed"]) assert(html.includes(value));
  const unsafe = renderToStaticMarkup(React.createElement(ResourceDetails, { resource: { ...resource, url: "javascript:alert(1)" } }));
  assert.doesNotMatch(unsafe, /href=/);
});
test("archive errors distinguish authentication, exhausted saves, missing records and recoverable failures", () => {
  assert.match(archiveError(new ApiError(401)), /Sign in/);
  assert.match(archiveError(new UpgradeRequiredError(null)), /still edit/);
  assert.match(archiveError(new ApiError(404)), /no longer available/);
  assert.match(archiveError(new ApiError(400)), /10,000/);
  assert.doesNotMatch(archiveError(new Error("secret")), /secret/);
});
