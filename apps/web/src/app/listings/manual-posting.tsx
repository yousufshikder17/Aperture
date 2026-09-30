"use client";
import React, { useEffect, useRef, useState } from "react";
import { ListingSchema, ManualListingCreateSchema, ManualListingDraftSchema, PostingImportSchema, type ManualListingDraft } from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { listingError } from "./listing-data";
import { useUnsavedChanges } from "../builder/use-unsaved-changes";

const empty: ManualListingDraft = { title: "", company: "", description: "", url: "", location: "", salary: "" };
export function postingError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "An earlier version of this posting was already saved. Refresh listings to review it before starting another posting.";
    if (error.status === 413) return "The upload is too large. Choose a file under 4 MiB, or paste the description.";
    if ([400, 415, 422].includes(error.status)) return "The posting could not be read. Use a UTF-8 TXT, DOCX, or PDF of up to 5 pages, or paste the description.";
  }
  return listingError(error);
}

export function ManualPosting({ onSaved }: { onSaved: () => void }) {
  const [draft, setDraft] = useState(empty);
  const [file, setFile] = useState<File | null>(null);
  const [imported, setImported] = useState<ReturnType<typeof PostingImportSchema.parse> | null>(null);
  const [method, setMethod] = useState<"text" | "ai">("text");
  const [savedId, setSavedId] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  const requestId = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useUnsavedChanges(Object.values(draft).some(Boolean) || !!imported);
  useEffect(() => () => request.current?.abort(), []);

  async function run(action: "save" | "import") {
    if (request.current) return;
    setError(""); setStatus("");
    if (action === "import" && (!file || file.size > 4 * 1024 * 1024)) {
      setError("Choose a TXT, DOCX, or PDF file under 4 MiB."); return;
    }
    requestId.current ??= crypto.randomUUID();
    const body = ManualListingCreateSchema.safeParse({ ...draft, requestId: requestId.current });
    if (action === "save" && !body.success) { setError(body.error.issues[0]?.message ?? "Complete the required fields."); return; }
    const controller = new AbortController(); request.current = controller; setBusy(action);
    try {
      if (action === "import") {
        const form = new FormData(); form.set("file", file!);
        form.set("method", method);
        const result = PostingImportSchema.parse(await api("/listings/import", { method: "POST", body: form, signal: controller.signal }));
        if (!controller.signal.aborted) { setImported(result); setStatus("Import ready. Review the text before using it."); }
      } else if (body.success) {
        const result = ListingSchema.parse(await api("/listings/manual", { method: "POST", body: JSON.stringify(body.data), signal: controller.signal }));
        if (!controller.signal.aborted) {
          setSavedId(result.id); setDraft(empty); setImported(null); setFile(null); setMethod("text");
          if (fileInput.current) fileInput.current.value = "";
          requestId.current = null; setStatus("Posting saved. Open it to score your resume or track an application."); onSaved();
        }
      }
    } catch (error) { if (!controller.signal.aborted) setError(postingError(error)); }
    finally { if (request.current === controller) { request.current = null; setBusy(""); } }
  }

  return <details className="listing-section manual-posting">
    <summary>Add a job posting</summary>
    <p>Paste a description or import a document. This posting is private to your account.</p>
    <form onSubmit={event => { event.preventDefault(); void run("save"); }}>
      <fieldset disabled={!!busy}>
        <legend>Posting details</legend>
        <div className="posting-fields">
          <label>Job title <span>(required)</span><input name="postingTitle" required maxLength={200} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
          <label>Company <span>(required)</span><input name="postingCompany" required maxLength={200} value={draft.company} onChange={e => setDraft({ ...draft, company: e.target.value })} /></label>
          <label>Location <input name="postingLocation" maxLength={300} value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value })} /></label>
          <label>Salary <input name="postingSalary" maxLength={200} value={draft.salary} onChange={e => setDraft({ ...draft, salary: e.target.value })} /></label>
        </div>
        <label>Original posting URL <span>(optional)</span><input type="url" name="postingUrl" maxLength={2048} value={draft.url} onChange={e => setDraft({ ...draft, url: e.target.value })} /></label>
        <p className="muted">The URL is saved as a link; it is not fetched.</p>
        <label>Description <span>(required)</span><textarea name="postingDescription" required rows={9} maxLength={50000} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
        <div className="posting-import">
          <label>Import description <input ref={fileInput} type="file" name="postingFile" accept=".txt,.docx,.pdf" aria-describedby="posting-file-help" onChange={e => { setFile(e.target.files?.[0] ?? null); setImported(null); setMethod("text"); }} /></label>
          <p id="posting-file-help" className="muted">TXT, DOCX, or PDF up to 4 MiB. PDFs: maximum 5 pages. Text extraction runs on Aperture without AI or an allowance. AI extraction sends the PDF to the AI provider and uses one match allowance.</p>
          {file?.name.toLowerCase().endsWith(".pdf") && <label>PDF extraction
            <select name="postingMethod" value={method} onChange={e => setMethod(e.target.value as "text" | "ai")} aria-describedby="posting-method-help">
              <option value="text">Text extraction (no AI)</option>
              <option value="ai">AI extraction (scans or difficult PDFs)</option>
            </select>
          </label>}
          <p id="posting-method-help" className="muted">Start with text extraction. A quality check flags pages with little readable text; it never switches to AI automatically. Review the result for missing text and reading order.</p>
          <button type="button" disabled={!file || !!busy} onClick={() => void run("import")}>{busy === "import" ? "Importing posting…" : "Import for review"}</button>
          {imported && <section aria-label="Imported posting review">
            <h3>Review imported text</h3>
            <p>{imported.review.method === "ai" ? "Extracted with AI" : "Extracted without AI"}</p>
            {imported.review.warnings.map(warning => <p key={warning} role="status">{warning}</p>)}
            {imported.review.method === "text" && imported.review.warnings.length > 0 && file?.name.toLowerCase().endsWith(".pdf") &&
              <p>Select <strong>AI extraction</strong> above, then choose <strong>Import for review</strong> to try again using one match allowance, or paste the description.</p>}
            {(imported.title || imported.company) && <p>{imported.title} · {imported.company}</p>}
            <label>Imported description<textarea readOnly rows={7} value={imported.description} /></label>
            <p>Using this draft replaces the description. You can correct all fields before saving.</p>
            <button type="button" disabled={!imported.description.trim()} onClick={() => {
              setDraft({ ...draft, ...Object.fromEntries(Object.entries(ManualListingDraftSchema.parse(imported)).filter(([, value]) => value)), description: imported.description });
              setImported(null); setStatus("Draft updated. Check the details, then save the posting.");
            }}>Use imported draft</button>
            <button type="button" onClick={() => setImported(null)}>Discard import</button>
          </section>}
        </div>
        <div className="listing-actions">
          <button className="listing-primary" type="submit">{busy === "save" ? "Saving posting…" : "Save posting"}</button>
          <button type="button" onClick={() => {
            if (!window.confirm("Clear this unsaved posting?")) return;
            setDraft(empty); setImported(null); setFile(null); setMethod("text"); setSavedId(""); setError(""); setStatus("");
            if (fileInput.current) fileInput.current.value = "";
            requestId.current = null;
          }}>Clear form</button>
        </div>
      </fieldset>
    </form>
    {error && <p role="alert" className="listing-error">{error}</p>}
    <p role="status">{status}</p>
    {savedId && <p><a href={`/listings/${encodeURIComponent(savedId)}`}>Open saved posting</a></p>}
  </details>;
}
