import React from "react";
import { ComplexityAssessmentSchema } from "@aperture/shared";
export interface ResourceRow {
  id: string;
  title: string;
  url: string;
  kind: string;
  skills: string[];
  level: string | null;
  timeCommitment: string | null;
  summary: string | null;
  complexityFlag: string | null;
}

export function ResourcesView({ rows, error, skill, level: requestedLevel }: { rows: ResourceRow[]; error: string | null; skill?: string; level: string; }) {
  const level = ComplexityAssessmentSchema.shape.level.safeParse(requestedLevel).data ?? "";
  const visible = level ? rows.filter(resource => resource.level === level) : rows;
  return (
    <>
      <h1>Resource director</h1>
      <p className="muted">
        Curated registry, complexity-tagged at index time.
        {skill && ` Filtered by gap: ${skill}.`}
      </p>
      <form action="/resources" method="get">
        {skill && <input type="hidden" name="skill" value={skill} />}
        <label htmlFor="resource-level">Resource level </label>
        <select id="resource-level" name="level" defaultValue={level} key={level}>
          <option value="">All levels</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
        </select>{" "}
        <button type="submit">Apply filter</button>
      </form>
      {error && <p role="alert" className="card flag">{error}</p>}
      {!error && visible.length === 0 && (
        <div className="card muted">
          {level || skill ? "No resources match these filters. Try another level or browse all resources." : "No learning resources are available yet."}
          {(level || skill) && <> <a href="/resources">Browse all resources</a></>}
        </div>
      )}
      {visible.map((r) => (
        <div className="card" key={r.id}>
          <a href={r.url}>
            <strong>{r.title}</strong>
          </a>{" "}
          <span className="muted">
            {r.kind}
            {r.level && ` · ${r.level}`}
            {r.timeCommitment && ` · ${r.timeCommitment}`}
          </span>
          {r.summary && <div>{r.summary}</div>}
          <div className="muted">Covers: {r.skills.join(", ")}</div>
          {r.complexityFlag && <div className="flag">{r.complexityFlag}</div>}
        </div>
      ))}
    </>
  );
}
