"use client";
import React, { useEffect, useRef, useState } from "react";
import { ResumeImportCapabilitiesSchema, type MasterResume, type ResumeImportResult, type ResumeImportMode } from "@aperture/shared";
import { api } from "../../lib/api";
import { importBody, parseExtraction, importError } from "./import-data";
import { useUnsavedChanges } from "./use-unsaved-changes";

export default function ResumeImport({ disabled, onAccept }: {
  disabled: boolean; onAccept: (resume: MasterResume, rawText?: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<ResumeImportResult | null>(null);
  const [mode, setMode] = useState<ResumeImportMode>("deterministic");
  const [capabilities, setCapabilities] = useState({ aiAvailable: false, visionAvailable: false });
  const [error, setError] = useState("");
  useUnsavedChanges(draft !== null);
  useEffect(() => {
    const request = new AbortController();
    void api("/builder/import-capabilities", { signal: request.signal }).then(value => {
      if (!request.signal.aborted) setCapabilities(ResumeImportCapabilitiesSchema.parse(value));
    }).catch(() => {}); // Capability lookup cannot prevent deterministic import.
    return () => { request.abort(); controller.current?.abort(); };
  }, []);
  async function extract(selectedMode: ResumeImportMode = mode) {
    if (controller.current || disabled) return;
    setError("");
    const file = input.current?.files?.[0];
    if (!file) { setError("Choose a PDF or DOCX file first."); return; }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    try {
      const body = importBody(file, selectedMode);
      const extraction = parseExtraction(await api("/builder/upload", {
        method: "POST", body, signal: request.signal,
      }));
      if (!request.signal.aborted) setDraft(extraction);
    } catch (cause) {
      if (!request.signal.aborted) setError(importError(cause));
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return <section className="builder-section" aria-labelledby="import-heading">
    <h2 id="import-heading">Import a resume</h2>
    <p className="muted">PDF or DOCX, up to 8 MiB. Deterministic import reads text without AI. Review the draft before replacing anything; importing never saves automatically.</p>
    <label className="builder-field">Resume file
      <input ref={input} type="file" accept=".pdf,.docx" disabled={disabled || busy}
        onChange={() => { setDraft(null); setError(""); }} />
    </label>
    <label className="builder-field">Extraction mode
      <select name="resumeImportMode" value={mode} disabled={disabled || busy} onChange={event => setMode(event.target.value as ResumeImportMode)}>
        <option value="deterministic">Deterministic — no AI</option>
        <option value="auto">Auto — AI fallback if needed</option>
        <option value="ai-assisted" disabled={!capabilities.aiAvailable}>AI-assisted</option>
      </select>
    </label>
    <p className="muted">Auto may send text or PDF page images to the configured AI provider when deterministic extraction is inadequate. AI-assisted sends extracted text, or PDF page images when vision is supported, for stronger interpretation.</p>
    <p className="muted">{capabilities.aiAvailable ? capabilities.visionAvailable
      ? "AI text and PDF vision import are configured." : "AI text import is configured. Scanned PDFs need a vision-capable model."
      : "No AI import provider is available. Text-based PDF and DOCX import still work."}</p>
    <button type="button" onClick={() => void extract()} disabled={disabled || busy}>
      {busy ? "Extracting resume…" : "Extract for review"}
    </button>
    {busy && <p role="status">Extracting your document. Your current resume is unchanged.</p>}
    {error && <p role="alert" className="builder-error">{error}</p>}
    {draft && <div className="builder-suggestion" aria-label="Import preview">
      <h3>Review extracted draft</h3>
      <p>{draft.import ? `${draft.import.method === "docx-text" ? "DOCX text extraction" : draft.import.method === "pdf-text" ? "PDF text-layer extraction" : draft.import.method === "ai-text" ? "AI text structuring" : "AI vision extraction"}. AI ${draft.import.aiUsed ? "was" : "was not"} used.` : "Extraction method was not reported."}</p>
      {draft.import?.warnings.length ? <ul>{draft.import.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
      <p>{draft.resume.basics.name || "Name not found"} — {draft.resume.basics.email || "Email not found"}</p>
      <p>{draft.resume.experience.length} roles, {draft.resume.projects.length} projects, {draft.resume.education.length} qualifications, {draft.resume.skills.length} skills.</p>
      <p>Check every field in the editor after accepting. Missing or incorrect details can be corrected before saving.</p>
      <h4>Layout findings</h4>
      {draft.import && draft.import.method !== "ai-vision" && <p>Only text/parser-visible issues can be assessed. Visual layout was not inspected.</p>}
      {draft.layoutFindings.length ? <ul>{draft.layoutFindings.map((finding, index) =>
        <li key={index}>{finding.atsRisk} risk: {finding.issue}. Suggested fix: {finding.fix}</li>)}</ul>
        : <p>No layout issues were reported. This is not a guarantee of ATS compatibility.</p>}
      {draft.import?.rawText && <details><summary>Extracted text for comparison</summary>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{draft.import.rawText}</pre></details>}
      {capabilities.aiAvailable && <button type="button" disabled={disabled || busy} onClick={() => {
        setMode("ai-assisted"); void extract("ai-assisted");
      }}>Retry with AI</button>}{" "}
      <button type="button" disabled={disabled || busy} onClick={() => {
        if (!window.confirm("Replace the current editor draft with this extraction? Unsaved editor changes will be discarded; your saved resume stays unchanged until you save.")) return;
        onAccept(draft.resume, draft.import?.rawText);
        setDraft(null);
      }}>Use extracted draft</button>{" "}
      <button type="button" onClick={() => setDraft(null)}>Discard import</button>
    </div>}
  </section>;
}
