"use client";

import { useEffect, useRef, useState } from "react";
import { assessTemplate, TemplateSchema, type ResumeSection, type ResumeTemplate } from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { useUnsavedChanges } from "../builder/use-unsaved-changes";
import "./templates.css";

const LABELS: Record<ResumeSection, string> = {
  summary: "Summary", experience: "Experience", projects: "Projects", skills: "Skills", education: "Education",
};

export default function Templates() {
  const [active, setActive] = useState<ResumeTemplate | null>(null);
  const [draft, setDraft] = useState<ResumeTemplate | null>(null);
  const [library, setLibrary] = useState<ResumeTemplate[]>([]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [hasResume, setHasResume] = useState(false);
  const pending = useRef(false);
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(active);
  useUnsavedChanges(dirty);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<{ template: ResumeTemplate }>("/templates/active", { signal: controller.signal }),
      api<ResumeTemplate[]>("/templates/library", { signal: controller.signal }),
      api<{ masterResume: unknown }>("/profile", { signal: controller.signal }),
    ]).then(([selected, catalog, profile]) => {
      if (controller.signal.aborted) return;
      setActive(TemplateSchema.parse(selected.template));
      setLibrary(TemplateSchema.array().parse(catalog));
      setHasResume(!!profile.masterResume);
    }).catch(() => { if (!controller.signal.aborted) setError("Templates could not load. Reload the page to try again."); });
    return () => controller.abort();
  }, []);

  function select(template: ResumeTemplate) {
    setDraft(TemplateSchema.parse(template));
    setPreview("");
    setError("");
    setStatus("");
    requestAnimationFrame(() => document.getElementById("template-editor")?.scrollIntoView({ behavior: "smooth" }));
  }

  function edit(template: ResumeTemplate) {
    setDraft(assessTemplate(template));
    setPreview("");
    setStatus("");
  }

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setBusy("search"); setError("");
    try {
      const results = await api<ResumeTemplate[]>(`/templates/library?q=${encodeURIComponent(query)}`);
      setLibrary(TemplateSchema.array().parse(results));
    } catch { setError("Search failed. Try again."); }
    finally { pending.current = false; setBusy(""); }
  }

  async function showPreview() {
    if (!draft || pending.current) return;
    const checked = TemplateSchema.safeParse(draft);
    if (!checked.success) { setError("Check the template fields before previewing."); return; }
    pending.current = true; setBusy("preview"); setError(""); setStatus("");
    try {
      const response = await fetch("/api/backend/templates/preview", {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify(checked.data),
      });
      if (response.status === 409) throw new Error("Save a master resume in the builder before previewing templates.");
      if (!response.ok) throw new ApiError(response.status);
      const blob = await response.blob();
      if (response.headers.get("content-type")?.split(";")[0] !== "application/pdf" ||
        await blob.slice(0, 5).text() !== "%PDF-") throw new Error("Preview was not a valid PDF.");
      setPreview(URL.createObjectURL(blob));
      setStatus("Preview ready. Review it before saving this design.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preview failed. Try again."); }
    finally { pending.current = false; setBusy(""); }
  }

  async function save() {
    if (!draft || !preview || pending.current) return;
    pending.current = true; setBusy("save"); setError(""); setStatus("");
    try {
      const saved = TemplateSchema.parse(await api("/templates/active", {
        method: "PUT", body: JSON.stringify(draft),
      }));
      setActive(saved); setDraft(saved);
      setStatus("Template saved. Your master resume PDF now uses this design.");
    } catch { setError("Template could not be saved. Your draft is still here; try again."); }
    finally { pending.current = false; setBusy(""); }
  }

  return <div className="template-page">
    <h1>Resume templates</h1>
    <p className="muted">Choose a curated design, make it your own, and preview it with your saved master resume before applying it to future PDF downloads.</p>
    <section className="template-current" aria-label="Current template">
      <div><strong>Current design: {active?.name ?? "Loading…"}</strong>
        <p className="muted">{active ? `${active.layout.columns} column${active.layout.columns === 2 ? "s" : ""} · ATS compatibility ${active.atsCompatibility.score}/100` : ""}</p></div>
      <a href="/builder">Edit resume content</a>
    </section>
    <p role="status" aria-live="polite">{status}</p>
    {error && <p role="alert" className="template-error">{error}</p>}
    {!hasResume && <p className="template-notice">Save a master resume in the <a href="/builder">builder</a> to preview and save a template.</p>}

    <section aria-labelledby="library-heading" className="template-section">
      <h2 id="library-heading">Find a design</h2>
      <p>Search the curated library by style, role, layout, or ATS compatibility.</p>
      <form className="template-search" onSubmit={(event) => void search(event)}>
        <label htmlFor="template-query">Describe your style</label>
        <div><input id="template-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Minimal, technical, two column…" />
          <button type="submit" disabled={!!busy}>{busy === "search" ? "Searching…" : "Search"}</button></div>
      </form>
      <div className="template-library">
        {library.map((item) => <article key={item.id} className="template-option">
          <h3>{item.name}</h3>
          <p>{item.tags.join(" · ")} · {item.layout.columns} column{item.layout.columns === 2 ? "s" : ""}</p>
          <p>Best for: {item.bestFor.join(", ")}</p>
          <p className={item.atsCompatibility.score < 100 ? "template-warning" : "template-safe"}>ATS compatibility {item.atsCompatibility.score}/100{item.atsCompatibility.warnings.length ? ` · ${item.atsCompatibility.warnings.join(" ")}` : ""}</p>
          <button type="button" onClick={() => select(item)} disabled={!!busy}>Review this design</button>
        </article>)}
        {!library.length && <p>No templates match that description. Try a broader term.</p>}
      </div>
    </section>

    {draft && <section id="template-editor" aria-labelledby="editor-heading" className="template-section">
      <h2 id="editor-heading">Review your design</h2>
      <p>Adjust the selected style, then preview it with your saved resume. Nothing changes until you save.</p>
      <div className="template-fields">
        <label>Name<input value={draft.name} maxLength={80} onChange={(event) => edit({ ...draft, name: event.target.value })} /></label>
        <label>Layout<select value={draft.layout.columns} onChange={(event) => {
          const columns = Number(event.target.value) as 1 | 2;
          edit({ ...draft, layout: { ...draft.layout, columns, sidebar: columns === 2 ? ["skills", "education"] : [] } });
        }}><option value="1">Single column</option><option value="2">Two columns</option></select></label>
        <label>Font<select value={draft.type.fontFamily} onChange={(event) => edit({ ...draft, type: { ...draft.type, fontFamily: event.target.value as ResumeTemplate["type"]["fontFamily"] } })}>
          <option value="Helvetica">Helvetica</option><option value="TimesRoman">Times Roman</option><option value="Courier">Courier</option></select></label>
        <label>Body size (pt)<input type="number" min="8" max="12" value={draft.type.bodySize} onChange={(event) => edit({ ...draft, type: { ...draft.type, bodySize: Number(event.target.value) } })} /></label>
        <label>Name size (pt)<input type="number" min="16" max="28" value={draft.type.nameSize} onChange={(event) => edit({ ...draft, type: { ...draft.type, nameSize: Number(event.target.value) } })} /></label>
        <label>Heading size (pt)<input type="number" min="10" max="15" value={draft.type.headingSize} onChange={(event) => edit({ ...draft, type: { ...draft.type, headingSize: Number(event.target.value) } })} /></label>
        <label>Page margin (pt)<input type="number" min="32" max="72" value={draft.spacing.margin} onChange={(event) => edit({ ...draft, spacing: { ...draft.spacing, margin: Number(event.target.value) } })} /></label>
        <label>Section gap (pt)<input type="number" min="4" max="20" value={draft.spacing.sectionGap} onChange={(event) => edit({ ...draft, spacing: { ...draft.spacing, sectionGap: Number(event.target.value) } })} /></label>
        <label>Heading color<input type="color" value={draft.color.accent} onChange={(event) => edit({ ...draft, color: { ...draft.color, accent: event.target.value } })} /></label>
        <label>Name color<input type="color" value={draft.color.primary} onChange={(event) => edit({ ...draft, color: { ...draft.color, primary: event.target.value } })} /></label>
        <label>Text color<input type="color" value={draft.color.text} onChange={(event) => edit({ ...draft, color: { ...draft.color, text: event.target.value } })} /></label>
        <label>Bullet style<select value={draft.spacing.bulletStyle} onChange={(event) => edit({ ...draft, spacing: { ...draft.spacing, bulletStyle: event.target.value as "bullet" | "dash" } })}>
          <option value="bullet">Bullet</option><option value="dash">Dash</option></select></label>
      </div>
      <fieldset className="template-order"><legend>Section order</legend>
        {draft.layout.sectionOrder.map((section, index) => <div key={section}>
          <span>{LABELS[section]}</span>
          {draft.layout.columns === 2 && <label><input type="checkbox" checked={draft.layout.sidebar.includes(section)} onChange={(event) => {
            const sidebar = event.target.checked ? [...draft.layout.sidebar, section] : draft.layout.sidebar.filter((value) => value !== section);
            if (!sidebar.length || sidebar.length > 2) return;
            edit({ ...draft, layout: { ...draft.layout, sidebar } });
          }} /> Sidebar</label>}
          <button type="button" disabled={index === 0} aria-label={`Move ${LABELS[section]} up`} onClick={() => {
            const order = [...draft.layout.sectionOrder]; [order[index - 1], order[index]] = [order[index]!, order[index - 1]!];
            edit({ ...draft, layout: { ...draft.layout, sectionOrder: order } });
          }}>↑</button>
          <button type="button" disabled={index === 4} aria-label={`Move ${LABELS[section]} down`} onClick={() => {
            const order = [...draft.layout.sectionOrder]; [order[index + 1], order[index]] = [order[index]!, order[index + 1]!];
            edit({ ...draft, layout: { ...draft.layout, sectionOrder: order } });
          }}>↓</button>
        </div>)}
      </fieldset>
      <p className={draft.atsCompatibility.score < 100 ? "template-warning" : "template-safe"}>ATS compatibility {draft.atsCompatibility.score}/100. {draft.atsCompatibility.warnings.join(" ") || "No layout warnings."}</p>
      <div className="template-actions"><button type="button" disabled={!!busy || !hasResume} onClick={() => void showPreview()}>{busy === "preview" ? "Building preview…" : "Preview with my resume"}</button>
        <button type="button" className="template-primary" disabled={!!busy || !preview || !dirty} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save this design"}</button></div>
      {preview && <div className="template-preview"><h3>Resume preview</h3><p>Check the reading order and page breaks before saving.</p>
        <iframe title="Visual resume template preview" src={preview} aria-hidden="true" tabIndex={-1} /><a href={preview} download="resume-template-preview.pdf">Download preview PDF</a></div>}
    </section>}
  </div>;
}
