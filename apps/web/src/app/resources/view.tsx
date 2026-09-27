"use client";
import React, { useEffect, useRef, useState } from "react";
import { ComplexityAssessmentSchema, ArchiveEntrySchema, ArchiveRecordSchema, type ResourceSummary } from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { archiveError } from "./resource-data";
import { ResourceDetails } from "./resource-card";

function SaveResource({ resourceId, saved, ready, onSaved }: {
  resourceId: string; saved: boolean; ready: boolean; onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function save() {
    if (request.current || saved || !ready) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      ArchiveRecordSchema.parse(await api("/resources/archive", { method: "POST", body: JSON.stringify({ resourceId }), signal: controller.signal }));
      if (!controller.signal.aborted) onSaved();
    } catch (cause) {
      if (!controller.signal.aborted) {
        if (cause instanceof ApiError && cause.status === 409) onSaved();
        else setError(archiveError(cause));
      }
    } finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <div className="resource-save">
    <button disabled={!ready || busy || saved} onClick={() => void save()}>{saved ? "Saved to archive" : busy ? "Saving…" : "Save to archive"}</button>
    {saved && <p role="status"><a href="/resources/archive">Edit notes and progress in your archive</a></p>}
    {error && <p role="alert" className="resource-error">{error} <a href="/account">Account</a></p>}
  </div>;
}

export function ResourcesView({ rows, skill, level: requestedLevel, error }: {
  rows: ResourceSummary[]; skill?: string; level: string; error: string | null;
}) {
  const level = ComplexityAssessmentSchema.shape.level.safeParse(requestedLevel).data ?? "";
  const [saved, setSaved] = useState<Set<string> | null>(null);
  const [archiveFailure, setArchiveFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  async function loadSaved() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setArchiveFailure("");
    try {
      const entries = ArchiveEntrySchema.array().parse(await api("/resources/archive", { signal: controller.signal }));
      if (!controller.signal.aborted) setSaved(new Set(entries.map(entry => entry.resourceId)));
    } catch (cause) { if (!controller.signal.aborted) setArchiveFailure(archiveError(cause)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  useEffect(() => { if (!error) void loadSaved(); return () => { request.current?.abort(); request.current = null; }; }, [error]);
  const visible = level ? rows.filter(row => row.level === level) : rows;
  return <div className="resource-workflow">
    <h1>Resources</h1>
    <p>Find a resource, save it, and keep track of what you learn.</p>
    <p><a href="/resources/archive">My resource archive</a></p>
    {skill && <p className="muted">Filtered by skill: {skill}.</p>}
    <form action="/resources" method="get" className="resource-filter">
      {skill && <input type="hidden" name="skill" value={skill} />}
      <label htmlFor="resource-level">Resource level</label>
      <select id="resource-level" name="level" defaultValue={level} key={level}>
        <option value="">All levels</option><option value="beginner">Beginner</option>
        <option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
      </select><button type="submit">Apply filter</button>
    </form>
    {error && <p role="alert" className="resource-error">{error} <a href="/account">Account</a></p>}
    {busy && <p role="status">Checking saved resources…</p>}
    {archiveFailure && <div role="alert"><p>Could not check saved resources. {archiveFailure}</p>
      <button disabled={busy} onClick={() => void loadSaved()}>Retry archive check</button></div>}
    {!error && visible.length === 0 && <p>{skill || level ? "No resources match these filters." : "No learning resources are available yet."} <a href="/resources">Browse all resources</a></p>}
    {visible.map(resource => <article className="resource-section" key={resource.id} aria-label={resource.title}>
      <ResourceDetails resource={resource} />
      <SaveResource resourceId={resource.id} saved={saved?.has(resource.id) ?? false} ready={saved !== null}
        onSaved={() => setSaved(current => new Set([...(current ?? []), resource.id]))} />
    </article>)}
  </div>;
}
