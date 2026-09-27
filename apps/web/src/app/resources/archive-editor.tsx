"use client";
import React, { useEffect, useRef, useState } from "react";
import { ArchiveRecordSchema, ProgressSchema, type ArchiveEntry } from "@aperture/shared";
import { api } from "../../lib/api";
import { useUnsavedChanges } from "../builder/use-unsaved-changes";
import { archiveError, progressLabel } from "./resource-data";

export function ArchiveEditor({ entry, onSaved }: { entry: ArchiveEntry; onSaved: (entry: ArchiveEntry) => void }) {
  const [progress, setProgress] = useState(entry.progress);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const dirty = progress !== entry.progress || notes !== (entry.notes ?? "");
  useUnsavedChanges(dirty || busy);
  useEffect(() => () => request.current?.abort(), []);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (request.current || !dirty) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setMessage("");
    try {
      const patch = { ...(progress !== entry.progress ? { progress } : {}), ...(notes !== (entry.notes ?? "") ? { notes } : {}) };
      const saved = ArchiveRecordSchema.parse(await api(`/resources/archive/${entry.id}`, {
        method: "PATCH", body: JSON.stringify(patch), signal: controller.signal,
      }));
      if (!controller.signal.aborted) {
        onSaved({ ...entry, ...saved }); setProgress(saved.progress); setNotes(saved.notes ?? ""); setMessage("Changes saved.");
      }
    } catch (cause) { if (!controller.signal.aborted) setError(archiveError(cause)); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <form className="archive-editor" onSubmit={event => void save(event)}>
    <fieldset disabled={busy}>
      <legend>Notes and learning progress</legend>
      <label htmlFor={`${entry.id}-progress`}>Progress</label>
      <select id={`${entry.id}-progress`} value={progress} onChange={event => { setProgress(ProgressSchema.parse(event.target.value)); setMessage(""); }}>
        {ProgressSchema.options.map(value => <option value={value} key={value}>{progressLabel[value]}</option>)}
      </select>
      <label htmlFor={`${entry.id}-notes`}>Notes (optional)</label>
      <textarea id={`${entry.id}-notes`} rows={4} maxLength={10000} value={notes} onChange={event => { setNotes(event.target.value); setMessage(""); }} />
      <button type="submit" disabled={!dirty}>{busy ? "Saving…" : "Save changes"}</button>
    </fieldset>
    {error && <p role="alert" className="resource-error">{error} <a href="/account">Account</a></p>}
    <p role="status">{message}</p>
  </form>;
}
