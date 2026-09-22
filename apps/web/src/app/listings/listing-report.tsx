import React from "react";
import type { MatchScore } from "@aperture/shared";

export function MatchReport({ score, version }: { score: MatchScore; version: number | null }) {
  return <section className="listing-section" aria-label="Match result">
    <h2>Transparent match: {score.overall.toFixed(1)} / 100</h2>
    {version !== null && <p className="muted">Scored against saved resume version {version}.</p>}
    <p>{score.verdict.replaceAll("_", " ")} — {score.rationale}</p>
    <p className="muted">Heuristic guidance, not a hiring prediction.</p>
    <h3>Score breakdown</h3>
    <ul>{Object.entries(score.subscores).map(([name, value]) => <li key={name}>{name}: {value.toFixed(1)} / 100</li>)}</ul>
    <h3>Strengths</h3>
    {score.strengths.length ? <ul>{score.strengths.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>None detected.</p>}
    <h3>Concerns</h3>
    {score.concerns.length ? <ul>{score.concerns.map((item, i) => <li key={i}>{item}</li>)}</ul> : <p>None detected.</p>}
  </section>;
}
