import assert from "node:assert/strict";
import test from "node:test";
import type { MasterResume } from "@aperture/shared";
import { buildSkillGaps } from "../src/lib/gap-analysis.js";
import { extractKeywords, hasKeyword, heuristicAtsSimulation } from "@aperture/ai";

const resume: MasterResume = {
  basics: { name: "Test", email: "test@example.test", phone: null, location: null, headline: null, links: [] },
  summary: null, experience: [], projects: [], education: [],
  skills: [{ name: "TypeScript", category: "language", level: "advanced", evidence: [] }],
  certifications: [], publications: [], awards: [], targetRoles: ["Software Engineer", "Data Analyst"],
};

test("gap analysis counts missing required skills per target role and excludes resume skills", () => {
  const gaps = buildSkillGaps(resume, [
    { title: "Software Engineer", description: "Python, SQL, TypeScript" },
    { title: "Senior Software Engineer", description: "Python, TypeScript" },
    { title: "Data Analyst", description: "Python, SQL" },
  ]);

  assert.deepEqual(gaps.find((gap) => gap.skill === "python" && gap.role_type === "Software Engineer"), {
    skill: "python", role_type: "Software Engineer", listings_requiring: 2, listings_total: 2, frequency_pct: 100,
  });
  assert.deepEqual(gaps.find((gap) => gap.skill === "sql" && gap.role_type === "Software Engineer"), {
    skill: "sql", role_type: "Software Engineer", listings_requiring: 1, listings_total: 2, frequency_pct: 50,
  });
  assert.equal(gaps.some((gap) => gap.skill === "typescript"), false);
  assert.doesNotThrow(() => JSON.stringify(gaps));
});

test("regression: JavaScript does not satisfy Java, and target titles are not skills", () => {
  const profile = { ...resume, summary: "JavaScript developer", skills: [] };
  const listing = { title: "Software Engineer", description: "Java required" };
  const gaps = buildSkillGaps(profile, [listing]);
  assert.deepEqual(gaps.map(g => g.skill), ["java"]);
  const ats = heuristicAtsSimulation(profile, { ...listing, id: "1", source: "manual",
    url: "https://example.test", company: "Test", location: null, salary: null, postedAt: null });
  assert(ats.missingKeywords.includes("java"));
  assert(!ats.missingKeywords.includes("software engineer"));
  assert(!extractKeywords("JavaScript MongoDB digital").some(k => ["java", "go", "git"].includes(k.term)));
});

test("skill boundaries preserve punctuation and multiword skills", () => {
  for (const term of ["C++", "C#", "Node.js", "CI/CD", "machine learning"])
    assert(hasKeyword(`Required: (${term}).`, term), term);
  assert(!hasKeyword("NoSQL", "SQL"));
  assert(!hasKeyword("C++", "C#"));
  assert.deepEqual(buildSkillGaps(resume, []), []);
  assert(!buildSkillGaps({ ...resume, summary: "Java" }, [{ title: "Engineer", description: "Java" }]).length);
});
