"use client";
import React, { useEffect, useRef, useState } from "react";
import { ArchiveEntrySchema, type ArchiveEntry } from "@aperture/shared";
import { api } from "../../lib/api";
import { archiveError, progressLabel } from "./resource-data";
import { ResourceDetails } from "./resource-card";
import { ArchiveEditor } from "./archive-editor";

export default function ResourceArchive() {
  const [rows, setRows] = useState<ArchiveEntry[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  async function load() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller; setBusy(true); setError("");
    try {
      const data = ArchiveEntrySchema.array().parse(await api("/resources/archive", { signal: controller.signal }));
      if (!controller.signal.aborted) setRows(data);
    } catch (cause) { if (!controller.signal.aborted) setError(archiveError(cause)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, []);
  return <div className="resource-workflow">
    <h1>My resource archive</h1>
    <p>Keep your notes and learning progress together. Save changes when you’re ready.</p>
    <p><a href="/resources">Browse learning resources</a></p>
    {busy && <p role="status">Loading archive…</p>}
    {error && <div role="alert" className="resource-error"><p>{error} <a href="/account">Account</a></p>
      <button disabled={busy} onClick={() => void load()}>Retry loading archive</button></div>}
    {rows?.length === 0 && <p>No saved resources yet. Browse resources and choose Save to archive.</p>}
    {rows?.map(entry => <article className="resource-section" key={entry.id} aria-label={entry.resource.title}>
      <ResourceDetails resource={entry.resource} />
      <p>{progressLabel[entry.progress]} <span className="muted">· Saved {entry.savedAt.slice(0, 10)}</span></p>
      <ArchiveEditor entry={entry} onSaved={saved => setRows(current => current!.map(row => row.id === saved.id ? saved : row))} />
    </article>)}
  </div>;
}
