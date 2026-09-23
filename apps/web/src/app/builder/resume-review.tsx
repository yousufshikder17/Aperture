import React from "react";
import type { MasterResume } from "@aperture/shared";

export default function ResumeReview({ resume }: { resume: MasterResume }) {
  return <article className="builder-review" aria-label="Resume draft review">
    <h3>{resume.basics.name}</h3>
    <p>{resume.basics.headline}</p>
    <p>{[resume.basics.email, resume.basics.phone, resume.basics.location].filter(Boolean).join(" · ")}</p>
    {resume.basics.links.map((link, i) => <p key={i}>{link.label}: {link.url}</p>)}
    {resume.targetRoles.length > 0 && <p>Target roles: {resume.targetRoles.join(", ")}</p>}
    {resume.summary && <><h4>Summary</h4><p>{resume.summary}</p></>}
    {resume.experience.length > 0 && <><h4>Experience</h4>{resume.experience.map((role, i) => <div key={i}>
      <p><strong>{role.title} · {role.company}</strong></p>
      <p>{[role.start, role.end ?? "Present", role.location].filter(Boolean).join(" · ")}</p>
      <ul>{role.bullets.map((bullet, j) => <li key={j}>{bullet}</li>)}</ul>
      {role.skills.length > 0 && <p>Skills used: {role.skills.join(", ")}</p>}
    </div>)}</>}
    {resume.projects.length > 0 && <><h4>Projects</h4>{resume.projects.map((project, i) => <div key={i}>
      <p><strong>{project.name}</strong></p><p>{project.url}</p><p>{project.description}</p>
      <ul>{project.bullets.map((bullet, j) => <li key={j}>{bullet}</li>)}</ul>
      {project.skills.length > 0 && <p>Skills used: {project.skills.join(", ")}</p>}
    </div>)}</>}
    {resume.education.length > 0 && <><h4>Education</h4>{resume.education.map((item, i) => <div key={i}>
      <p><strong>{item.credential} · {item.institution}</strong></p>
      <p>{[item.field, item.start, item.end, item.gpa && `GPA: ${item.gpa}`].filter(Boolean).join(" · ")}</p>
    </div>)}</>}
    {resume.skills.length > 0 && <><h4>Skills</h4><ul>{resume.skills.map((skill, i) => <li key={i}>
      <strong>{skill.name}</strong>{[skill.category, skill.level].filter(Boolean).map(value => ` · ${value}`).join("")}
      {skill.evidence.length > 0 && ` — demonstrated in ${skill.evidence.join(", ")}`}
    </li>)}</ul></>}
    {(["certifications", "publications", "awards"] as const).map(key => resume[key].length > 0 && <div key={key}>
      <h4>{key[0]!.toUpperCase() + key.slice(1)}</h4>
      <ul>{resume[key].map((item, i) => <li key={i}>{item}</li>)}</ul>
    </div>)}
  </article>;
}
