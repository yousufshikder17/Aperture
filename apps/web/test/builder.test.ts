import assert from "node:assert/strict";
import test from "node:test";
import { MasterResumeSchema, type MasterResume } from "@aperture/shared";
import { emptyResume, resumeFromForm } from "../src/app/builder/form-data.js";

function formFor(resume: MasterResume) {
  const form = new FormData();
  const put = (name: string, value: unknown) =>
    form.append(name, value == null ? "" : String(value));
  for (const [key, value] of Object.entries(resume.basics))
    if (key !== "links") put(key, value);
  put("summary", resume.summary);
  for (const key of [
    "targetRoles",
    "certifications",
    "publications",
    "awards",
  ] as const)
    put(key, resume[key].join("\n"));
  const collections = {
    links: resume.basics.links,
    experience: resume.experience,
    projects: resume.projects,
    education: resume.education,
    skills: resume.skills,
  };
  for (const [name, rows] of Object.entries(collections))
    rows.forEach((row, index) => {
      // Deliberate gaps simulate rows removed before save.
      const id = index * 3 + 2;
      put(name, id);
      for (const [key, value] of Object.entries(row)) {
        if (key === "bullets")
          for (const bullet of value as string[])
            put(`${name}.${id}.${key}`, bullet);
        else
          put(
            `${name}.${id}.${key}`,
            Array.isArray(value) ? value.join("\n") : value,
          );
      }
    });
  return form;
}

test("empty form has the complete schema and independent arrays", () => {
  assert.deepEqual(resumeFromForm(new FormData()), emptyResume());
  const first = emptyResume();
  first.awards.push("A");
  assert.deepEqual(emptyResume().awards, []);
  assert.equal(MasterResumeSchema.safeParse(first).success, true);
});

test("editing round-trips every existing master-resume field without dropping optional data", () => {
  const resume: MasterResume = {
    basics: {
      name: "Synthetic Candidate",
      email: "candidate@example.test",
      phone: "+1 555 0100",
      location: "Toronto",
      headline: "Engineer",
      links: [{ label: "Work", url: "https://example.test" }],
    },
    summary: "A synthetic test resume.",
    targetRoles: ["Engineer", "Researcher"],
    experience: [
      {
        company: "Example",
        title: "Developer",
        start: "2024-01",
        end: null,
        location: "Remote",
        bullets: ["Built a parser", "Reviewed changes"],
        skills: ["TypeScript"],
      },
      {
        company: "Earlier",
        title: "Intern",
        start: "2023-01-01",
        end: "2023-12",
        location: null,
        bullets: [],
        skills: [],
      },
    ],
    projects: [
      {
        name: "Parser",
        url: "https://example.test/parser",
        description: "A parser",
        bullets: ["Parsed inputs"],
        skills: ["Rust"],
      },
    ],
    education: [
      {
        institution: "Example College",
        credential: "BSc",
        field: "Computing",
        start: "2020",
        end: "2024",
        gpa: "3.8",
      },
    ],
    skills: [
      {
        name: "TypeScript",
        category: "language",
        level: "advanced",
        evidence: ["Example", "Parser"],
      },
      { name: "Writing", category: "domain", level: null, evidence: [] },
    ],
    certifications: ["Certificate A"],
    publications: ["Publication A"],
    awards: ["Award A"],
  };
  assert.deepEqual(resumeFromForm(formFor(resume)), resume);
});

test("removed rows are omitted and repeated bullets keep order", () => {
  const data = new FormData();
  data.append("projects", "7");
  data.append("projects.7.name", "Keep");
  data.append("projects.2.name", "Removed");
  data.append("projects.7.bullets", " First ");
  data.append("projects.7.bullets", "");
  data.append("projects.7.bullets", "Second");
  const result = resumeFromForm(data);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0]?.name, "Keep");
  assert.deepEqual(result.projects[0]?.bullets, ["First", "Second"]);
});

test("multiline values normalize CRLF, optional blanks become null, and invalid levels fail", () => {
  const data = new FormData();
  data.set("targetRoles", " Engineer\r\n\r\nResearcher ");
  data.set("phone", "   ");
  assert.deepEqual(resumeFromForm(data).targetRoles, [
    "Engineer",
    "Researcher",
  ]);
  assert.equal(resumeFromForm(data).basics.phone, null);
  data.set("skills", "0");
  data.set("skills.0.level", "expert");
  assert.throws(() => resumeFromForm(data));
});
