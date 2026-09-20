"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ReferenceListSchema, type ReferenceList } from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { Field, Collection } from "./builder-fields";
import { referencesFromForm } from "./reference-data";
import { useUnsavedChanges } from "./use-unsaved-changes";

export default function ReferencesEditor({ onSaved }: { onSaved?: () => void }) {
  const [initial, setInitial] = useState<ReferenceList | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState("");
  const pending = useRef(false);
  useUnsavedChanges(dirty);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const profile = await api<{ referenceList: unknown }>("/profile", { signal });
      const list = ReferenceListSchema.parse(profile.referenceList ?? { references: [] });
      if (!signal?.aborted) setInitial(list);
    } catch {
      if (!signal?.aborted) setError("References could not be loaded. Retry before editing to avoid replacing existing references.");
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const changed = () => { setDirty(true); setSaved(""); };
  return <section className="builder-section" aria-labelledby="references-heading">
    <h2 id="references-heading">Reference list</h2>
    <p className="muted">Saved separately from your resume. Include contact details only with the person's permission.</p>
    {loading ? <p role="status">Loading references…</p> : !initial ? <>
      <p role="alert" className="builder-error">{error}</p>
      <button type="button" onClick={() => void load()}>Retry references</button>
    </> : <form className="references-form" onChange={changed} onSubmit={async event => {
      event.preventDefault();
      if (pending.current) return;
      const form = new FormData(event.currentTarget);
      pending.current = true; setSaving(true); setError(""); setSaved("");
      try {
        const draft = referencesFromForm(form);
        const response = await api<{ referenceList: unknown }>("/profile/references", {
          method: "PUT", body: JSON.stringify(draft),
        });
        ReferenceListSchema.parse(response.referenceList);
        setDirty(false); setSaved("References saved."); onSaved?.();
      } catch (cause) {
        setError(cause instanceof ApiError && cause.status === 401
          ? "Sign in again before saving references. Your draft is still here."
          : "Reference save could not be confirmed. Your draft is still here; retry when connected.");
      } finally { pending.current = false; setSaving(false); }
    }}>
      <fieldset disabled={saving} className="builder-fields">
        <Collection name="references" title="People" singular="Reference" initial={initial.references}
          dirty={changed} create={() => ({ name: "", relationship: "", title: "", company: "",
            seniority: "ic" as const, lastWorkedTogether: "", contact: null, notes: null })}>
          {(row, prefix) => <>
            <Field name={prefix + ".name"} label="Reference name" value={row.name} required />
            <Field name={prefix + ".relationship"} label="Relationship" value={row.relationship} required />
            <Field name={prefix + ".title"} label="Reference title" value={row.title} />
            <Field name={prefix + ".company"} label="Reference company" value={row.company} />
            <label className="builder-field">Seniority
              <select name={prefix + ".seniority"} defaultValue={row.seniority}>
                <option value="ic">Individual contributor</option><option value="manager">Manager</option>
                <option value="director">Director</option><option value="vp">Vice president</option>
                <option value="exec">Executive</option>
              </select>
            </label>
            <Field name={prefix + ".lastWorkedTogether"} label="Last worked together" value={row.lastWorkedTogether} hint="ISO date, for example 2025-06-01." />
            <Field name={prefix + ".contact"} label="Contact details" value={row.contact} />
            <Field name={prefix + ".notes"} label="Reference notes" value={row.notes} multiline />
          </>}
        </Collection>
        <button type="submit" disabled={!dirty || saving}>{saving ? "Saving references…" : "Save references"}</button>
      </fieldset>
      <p role="status">{saved || (dirty ? "Unsaved reference changes" : "")}</p>
      {error && <p role="alert" className="builder-error">{error}</p>}
    </form>}
  </section>;
}
