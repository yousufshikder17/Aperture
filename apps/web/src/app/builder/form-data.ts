import { MasterResumeSchema, type MasterResume } from "@aperture/shared";

export function emptyResume(): MasterResume {
  return {
    basics: {
      name: "",
      email: "",
      phone: null,
      location: null,
      headline: null,
      links: [],
    },
    summary: null,
    experience: [],
    projects: [],
    education: [],
    skills: [],
    certifications: [],
    publications: [],
    awards: [],
    targetRoles: [],
  };
}

// Stable row names prevent a removed row's uncontrolled inputs from moving to
// the following entry. Read only rows still represented by hidden form inputs.
export function resumeFromForm(data: FormData): MasterResume {
  const text = (name: string) => String(data.get(name) ?? "").trim();
  const optional = (name: string) => text(name) || null;
  const lines = (name: string) =>
    text(name)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  const bullets = (name: string) =>
    data
      .getAll(name)
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean);
  const rows = <T>(name: string, read: (prefix: string) => T) =>
    data.getAll(name).map((id) => read(`${name}.${id}`));
  return MasterResumeSchema.parse({
    basics: {
      name: text("name"),
      email: text("email"),
      phone: optional("phone"),
      location: optional("location"),
      headline: optional("headline"),
      links: rows("links", (p) => ({
        label: text(`${p}.label`),
        url: text(`${p}.url`),
      })),
    },
    summary: optional("summary"),
    targetRoles: lines("targetRoles"),
    experience: rows("experience", (p) => ({
      company: text(`${p}.company`),
      title: text(`${p}.title`),
      start: text(`${p}.start`),
      end: optional(`${p}.end`),
      location: optional(`${p}.location`),
      bullets: bullets(`${p}.bullets`),
      skills: lines(`${p}.skills`),
    })),
    projects: rows("projects", (p) => ({
      name: text(`${p}.name`),
      url: optional(`${p}.url`),
      description: text(`${p}.description`),
      bullets: bullets(`${p}.bullets`),
      skills: lines(`${p}.skills`),
    })),
    education: rows("education", (p) => ({
      institution: text(`${p}.institution`),
      credential: text(`${p}.credential`),
      field: optional(`${p}.field`),
      start: optional(`${p}.start`),
      end: optional(`${p}.end`),
      gpa: optional(`${p}.gpa`),
    })),
    skills: rows("skills", (p) => ({
      name: text(`${p}.name`),
      category: text(`${p}.category`),
      level: optional(`${p}.level`),
      evidence: lines(`${p}.evidence`),
    })),
    certifications: lines("certifications"),
    publications: lines("publications"),
    awards: lines("awards"),
  });
}
