import React from "react";
export interface SkillGap {
  skill: string;
  role_type: string | null;
  frequency_pct: number | null;
  listings_requiring: number;
  listings_total: number;
}

export function GapAnalysisView({ gaps, error }: { gaps: SkillGap[]; error: string | null; }) {
  return (
    <>
      <h1>Gap analysis</h1>
      <p className="muted">Skills missing from your saved resume, ranked by their frequency within each role among listings you have scored.</p>
      {error ? (
        <div role="alert" className="card flag">{error}</div>
      ) : gaps.length === 0 ? (
        <div className="card muted">No skill gaps yet. Score listings first; gaps update from the listings you analyze.</div>
      ) : (
        <div className="card">
          <ul>
            {gaps.map((gap) => (
              <li key={`${gap.skill}:${gap.role_type ?? "all"}`}>
                <strong>{gap.skill}</strong>{gap.role_type && ` · ${gap.role_type}`} — {gap.listings_requiring}/{gap.listings_total} listings
                {gap.frequency_pct !== null && ` (${gap.frequency_pct}%)`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
