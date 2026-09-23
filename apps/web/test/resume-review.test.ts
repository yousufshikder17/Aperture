import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResumeReview from "../src/app/builder/resume-review.js";
import { emptyResume } from "../src/app/builder/form-data.js";
import { ApiError, fetchMasterResumePdf } from "../src/lib/api.js";

test("draft review covers the resume and escapes user content", () => {
  const resume = emptyResume();
  resume.basics = { name: "Candidate", email: "test@example.test", phone: "555", location: "Toronto",
    headline: "Engineer", links: [{ label: "Portfolio", url: "javascript:alert(1)" }] };
  resume.summary = "<script>untrusted</script>";
  resume.targetRoles = ["Developer"];
  resume.experience = [{ company: "Example", title: "Intern", start: "2024", end: null, location: "Remote",
    bullets: ["Built tools"], skills: ["TypeScript"] }];
  resume.projects = [{ name: "Parser", url: "https://example.test", description: "Text parser", bullets: ["Parsed inputs"], skills: ["Rust"] }];
  resume.education = [{ institution: "College", credential: "BSc", field: "Computing", start: "2020", end: "2024", gpa: "3.8" }];
  resume.skills = [{ name: "Rust", category: "language", level: "advanced", evidence: ["Parser"] }];
  resume.certifications = ["Certificate A"]; resume.publications = ["Paper A"]; resume.awards = ["Award A"];
  const html = renderToStaticMarkup(React.createElement(ResumeReview, { resume }));
  for (const value of ["Candidate", "555", "Toronto", "Engineer", "Portfolio", "Developer", "Present", "Built tools",
    "TypeScript", "Parsed inputs", "Computing", "GPA: 3.8", "advanced", "demonstrated in Parser", "Certificate A", "Paper A", "Award A"])
    assert.ok(html.includes(value), value);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
});

test("master PDF uses the authenticated proxy and rejects failures or invalid files", async t => {
  let response = new Response("%PDF-test", { headers: { "content-type": "application/pdf" } });
  t.mock.method(globalThis, "fetch", async (url: unknown, init: RequestInit) => {
    assert.equal(url, "/api/backend/profile/pdf");
    assert.equal(init.credentials, "same-origin");
    assert.equal(init.redirect, "error");
    return response;
  });
  assert.equal(await (await fetchMasterResumePdf()).text(), "%PDF-test");
  response = new Response("failure", { status: 503 });
  await assert.rejects(fetchMasterResumePdf(), ApiError);
  response = new Response("<html>login</html>", { headers: { "content-type": "text/html" } });
  await assert.rejects(fetchMasterResumePdf(), /invalid_pdf/);
  response = new Response("not a PDF", { headers: { "content-type": "application/pdf" } });
  await assert.rejects(fetchMasterResumePdf(), /invalid_pdf/);
});
