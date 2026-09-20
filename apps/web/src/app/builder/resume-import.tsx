"use client";
import { useEffect, useRef, useState } from "react";
import type { MasterResume, ResumeExtraction } from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { importBody, parseExtraction } from "./import-data";
import { useUnsavedChanges } from "./use-unsaved-changes";

export default function ResumeImport({ disabled, onAccept }: {
  disabled: boolean; onAccept: (resume: MasterResume) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ResumeExtraction | null>(null);
  const [error, setError] = useState("");
  useUnsavedChanges(draft !== null);
  useEffect(() => () => controller.current?.abort(), []);
  async function extract() {
    if (controller.current || disabled) return;
    setError("");
    const file = input.current?.files?.[0];
    if (!file) { setError("Choose a PDF or DOCX file first."); return; }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const body = importBody(file);
      const extraction = parseExtraction(await api("/builder/upload", {
        method: "POST", body, signal: request.signal,
      }));
      if (!request.signal.aborted) setDraft(extraction);
    } catch (cause) {
      if (!request.signal.aborted) setError(cause instanceof ApiError
        ? cause.status === 401 ? "Sign in again, then retry the import. Your current draft is unchanged."
        : cause.status === 413 ? "The server rejected this file as too large. Choose a smaller file."
        : "Extraction failed. Retry or keep editing your current resume."
        : cause instanceof Error && !cause.name.includes("Zod") && !request.signal.aborted
          && /Choose a/.test(cause.message) ? cause.message
        : "The extracted resume could not be read. Your current draft is unchanged.");
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return <section className="builder-section" aria-labelledby="import-heading">
    <h2 id="import-heading">Import a resume</h2>
    <p className="muted">PDF or DOCX, up to 8 MiB. Extraction sends this document to the configured AI provider. Review the draft before replacing anything; importing never saves automatically.</p>
    <label className="builder-field">Resume file
      <input ref={input} type="file" accept=".pdf,.docx" disabled={disabled || busy}
        onChange={() => { setDraft(null); setError(""); }} />
    </label>
    <button type="button" onClick={() => void extract()} disabled={disabled || busy}>
      {busy ? "Extracting resume…" : "Extract for review"}
    </button>
    {busy && <p role="status">Extracting your document. Your current resume is unchanged.</p>}
    {error && <p role="alert" className="builder-error">{error}</p>}
    {draft && <div className="builder-suggestion" aria-label="Import preview">
      <h3>Review extracted draft</h3>
      <p>{draft.resume.basics.name || "Name not found"} — {draft.resume.basics.email || "Email not found"}</p>
      <p>{draft.resume.experience.length} roles, {draft.resume.projects.length} projects, {draft.resume.education.length} qualifications, {draft.resume.skills.length} skills.</p>
      <p>Check every field in the editor after accepting. Missing or incorrect details can be corrected before saving.</p>
      <h4>Layout findings</h4>
      {draft.layoutFindings.length ? <ul>{draft.layoutFindings.map((finding, index) =>
        <li key={index}>{finding.atsRisk} risk: {finding.issue}. Suggested fix: {finding.fix}</li>)}</ul>
        : <p>No layout issues were reported. This is not a guarantee of ATS compatibility.</p>}
      <button type="button" disabled={disabled} onClick={() => {
        if (!window.confirm("Replace the current editor draft with this extraction? Unsaved editor changes will be discarded; your saved resume stays unchanged until you save.")) return;
        onAccept(draft.resume);
        setDraft(null);
      }}>Use extracted draft</button>{" "}
      <button type="button" onClick={() => setDraft(null)}>Discard import</button>
    </div>}
  </section>;
}
