"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  MasterResumeSchema,
  type MasterResume,
  VersionSummarySchema,
  type VersionSummary,
} from "@aperture/shared";
import { api, ApiError } from "../../lib/api";
import { emptyResume, resumeFromForm } from "./form-data";
import ResumeImport from "./resume-import";
import { useUnsavedChanges } from "./use-unsaved-changes";
import { Field, Collection } from "./builder-fields";
import ReferencesEditor from "./references-editor";
import BuilderInsights, { formatScore } from "./builder-insights";

type Profile = { masterResume: MasterResume | null; version: number };
type Version = VersionSummary;

function message(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 401)
    return "Authentication is required. Check your configured sign-in or local development credential, then retry.";
  if (error instanceof ApiError && error.status === 403)
    return "Your account does not have access to this action.";
  return fallback;
}

function Bullets({
  prefix,
  initial,
  dirty,
}: {
  prefix: string;
  initial: string[];
  dirty: () => void;
}) {
  return (
    <div className="builder-wide">
      <Collection
        name={`${prefix}.bulletRows`}
        title="Bullets"
        singular="Bullet"
        initial={initial}
        create={() => ""}
        dirty={dirty}
      >
        {(value) => (
          <div className="builder-wide">
            <Field name={`${prefix}.bullets`} label="Resume bullet" value={value} multiline />
          </div>
        )}
      </Collection>
    </div>
  );
}

function ResumeForm({
  resume,
  version,
  onSaved,
  onImport,
  imported = false,
}: {
  resume: MasterResume;
  version: number;
  onSaved: (version: number, resume: MasterResume) => void;
  onImport: (resume: MasterResume) => void;
  imported?: boolean;
}) {
  const [dirty, setDirty] = useState(imported);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const pending = useRef(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const changed = () => {
    setDirty(true);
    setSaved("");
  };

  useUnsavedChanges(dirty);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  return (
    <>
    <ResumeImport disabled={saving} onAccept={onImport} />
    <form
      className="builder-form"
      onChange={changed}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current) return;
        const data = new FormData(event.currentTarget);
        pending.current = true;
        setSaving(true);
        setError("");
        setSaved("");
        try {
          const draft = resumeFromForm(data);
          const result = await api<Profile>("/profile", {
            method: "PUT",
            body: JSON.stringify(draft),
          });
          if (!Number.isInteger(result.version) || result.version < 1)
            throw new Error("Invalid save response");
          setDirty(false);
          setSaved(`Saved as version ${result.version}.`);
          onSaved(result.version, draft);
        } catch (cause) {
          setError(
            message(
              cause,
              "Save could not be confirmed. Your draft is still here. Check your connection before trying again.",
            ),
          );
        } finally {
          pending.current = false;
          setSaving(false);
        }
      }}
    >
      <div className="builder-savebar">
        <div>
          <strong>
            {version
              ? `Master resume · version ${version}`
              : "Your first master resume"}
          </strong>
          <p role="status">
            {saving
              ? "Saving resume…"
              : saved ||
                (dirty
                  ? "Unsaved changes"
                  : "Changes are saved only when you choose Save resume.")}
          </p>
        </div>
        <button
          type="submit"
          disabled={saving || (!dirty && version > 0)}
          className="builder-primary"
        >
          {saving ? "Saving…" : "Save resume"}
        </button>
      </div>
      {error && (
        <p ref={errorBox} tabIndex={-1} role="alert" className="builder-error">
          {error}
        </p>
      )}
      <nav className="builder-guide" aria-label="Resume sections">
        <ol>
          {[
            ["basics", "About you"], ["links", "Links"],
            ["experience", "Experience"], ["projects", "Projects"],
            ["education", "Education"], ["skills", "Skills"],
            ["additional", "Additional details"], ["review", "Review and finish"],
          ].map(([id, label]) => <li key={id}><a href={`#builder-${id}`}>{label}</a></li>)}
        </ol>
      </nav>
      <fieldset disabled={saving} className="builder-fields">
        <legend className="builder-sr-only">Resume details</legend>
        <section id="builder-basics" className="builder-section" aria-labelledby="basics-heading">
          <h2 id="basics-heading">About you</h2>
          <p className="muted">
            Name and email are required. Everything else can be added when you
            are ready.
          </p>
          <div className="builder-grid">
            <Field
              name="name"
              label="Full name"
              value={resume.basics.name}
              required
            />
            <Field
              name="email"
              label="Email"
              type="email"
              value={resume.basics.email}
              required
            />
            <Field
              name="headline"
              label="Headline"
              value={resume.basics.headline}
              hint="Describe your role or specialty in a short phrase."
            />
            <Field
              name="location"
              label="Location"
              value={resume.basics.location}
            />
            <Field
              name="phone"
              label="Phone"
              type="tel"
              value={resume.basics.phone}
            />
            <Field
              name="targetRoles"
              label="Target roles"
              value={resume.targetRoles.join("\n")}
              multiline
              hint="One role per line. These guide matching."
            />
          </div>
          <Field
            name="summary"
            label="Summary"
            value={resume.summary}
            multiline
            hint="Introduce your strengths, relevant experience, and the kind of work you want to do."
          />
        </section>
        <Collection
          name="links"
          title="Links"
          description="Add a portfolio, professional profile, or work sample you want employers to see."
          singular="Link"
          initial={resume.basics.links}
          create={() => ({ label: "", url: "" })}
          dirty={changed}
        >
          {(row, p) => (
            <>
              <Field
                name={`${p}.label`}
                label="Link label"
                value={row.label}
                required
              />
              <Field
                name={`${p}.url`}
                label="Link URL"
                value={row.url}
                required
              />
            </>
          )}
        </Collection>
        <Collection
          name="experience"
          title="Experience"
          description="Start with your most recent role. For each bullet, describe what you did, how you did it, and the result. Include numbers only when you can support them."
          singular="Role"
          initial={resume.experience}
          create={() => ({
            company: "",
            title: "",
            start: "",
            end: null,
            location: null,
            bullets: [],
            skills: [],
          })}
          dirty={changed}
        >
          {(row, p) => (
            <>
              <Field
                name={`${p}.company`}
                label="Company"
                value={row.company}
                required
              />
              <Field
                name={`${p}.title`}
                label="Job title"
                value={row.title}
                required
              />
              <Field
                name={`${p}.start`}
                label="Start date"
                value={row.start}
                hint="YYYY-MM or YYYY-MM-DD."
              />
              <Field
                name={`${p}.end`}
                label="End date"
                value={row.end}
                hint="Leave blank for a current role."
              />
              <Field
                name={`${p}.location`}
                label="Role location"
                value={row.location}
              />
              <Field
                name={`${p}.skills`}
                label="Skills used"
                value={row.skills.join("\n")}
                multiline
                hint="One skill per line."
              />
              <Bullets prefix={p} initial={row.bullets} dirty={changed} />
            </>
          )}
        </Collection>
        <Collection
          name="projects"
          title="Projects"
          description="Show relevant work from study, volunteering, or personal projects. Explain your contribution and what it achieved."
          singular="Project"
          initial={resume.projects}
          create={() => ({
            name: "",
            url: null,
            description: "",
            bullets: [],
            skills: [],
          })}
          dirty={changed}
        >
          {(row, p) => (
            <>
              <Field
                name={`${p}.name`}
                label="Project name"
                value={row.name}
                required
              />
              <Field name={`${p}.url`} label="Project URL" value={row.url} />
              <Field
                name={`${p}.description`}
                label="Description"
                value={row.description}
                multiline
              />
              <Field
                name={`${p}.skills`}
                label="Project skills"
                value={row.skills.join("\n")}
                multiline
                hint="One skill per line."
              />
              <Bullets prefix={p} initial={row.bullets} dirty={changed} />
            </>
          )}
        </Collection>
        <Collection
          name="education"
          title="Education"
          description="Add qualifications relevant to your target roles. You can include a degree still in progress."
          singular="Qualification"
          initial={resume.education}
          create={() => ({
            institution: "",
            credential: "",
            field: null,
            start: null,
            end: null,
            gpa: null,
          })}
          dirty={changed}
        >
          {(row, p) => (
            <>
              <Field
                name={`${p}.institution`}
                label="Institution"
                value={row.institution}
                required
              />
              <Field
                name={`${p}.credential`}
                label="Qualification"
                value={row.credential}
                required
              />
              <Field
                name={`${p}.field`}
                label="Field of study"
                value={row.field}
              />
              <Field name={`${p}.gpa`} label="GPA" value={row.gpa} />
              <Field
                name={`${p}.start`}
                label="Study start date"
                value={row.start}
              />
              <Field name={`${p}.end`} label="Study end date" value={row.end} />
            </>
          )}
        </Collection>
        <Collection
          name="skills"
          title="Skills"
          description="List skills you can demonstrate and connect them to the roles or projects where you used them."
          singular="Skill"
          initial={resume.skills}
          create={() => ({ name: "", category: "", level: null, evidence: [] })}
          dirty={changed}
        >
          {(row, p) => (
            <>
              <Field
                name={`${p}.name`}
                label="Skill name"
                value={row.name}
                required
              />
              <Field
                name={`${p}.category`}
                label="Category"
                value={row.category}
                hint="For example: language, framework, or domain."
              />
              <label className="builder-field">
                Level
                <select name={`${p}.level`} defaultValue={row.level ?? ""}>
                  <option value="">Not specified</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </label>
              <Field
                name={`${p}.evidence`}
                label="Supporting roles or projects"
                value={row.evidence.join("\n")}
                multiline
                hint="One name per line."
              />
            </>
          )}
        </Collection>
        <section
          id="builder-additional"
          className="builder-section"
          aria-labelledby="additional-heading"
        >
          <h2 id="additional-heading">Additional details</h2>
          <p className="muted">Optional: include credentials, publications, or recognition that support your application.</p>
          <Field
            name="certifications"
            label="Certifications"
            value={resume.certifications.join("\n")}
            multiline
            hint="One certification per line."
          />
          <Field
            name="publications"
            label="Publications"
            value={resume.publications.join("\n")}
            multiline
            hint="One publication per line."
          />
          <Field
            name="awards"
            label="Awards"
            value={resume.awards.join("\n")}
            multiline
            hint="One award per line."
          />
        </section>
      </fieldset>
    </form>
    </>
  );
}

export default function ResumeBuilder() {
  const [draftKey, setDraftKey] = useState(0);
  const [imported, setImported] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(true);
  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const rows = VersionSummarySchema.array().parse(await api("/builder/versions", { signal }));
      if (!signal?.aborted) setVersions(rows);
    } catch {
      if (!signal?.aborted)
        setHistoryError(
          "Version history could not be loaded. This does not prevent editing or saving.",
        );
    } finally {
      if (!signal?.aborted) setHistoryLoading(false);
    }
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await api<Profile>("/profile", { signal });
      if (!Number.isInteger(result.version) || result.version < 0)
        throw new Error("Invalid profile");
      const masterResume =
        result.masterResume === null
          ? null
          : MasterResumeSchema.parse(result.masterResume);
      if (!signal?.aborted)
        setProfile({ masterResume, version: result.version });
    } catch (cause) {
      if (!signal?.aborted)
        setError(
          message(
            cause,
            "Your resume could not be loaded. Retry before editing so an existing resume is not replaced.",
          ),
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    void loadHistory(controller.signal);
    return () => controller.abort();
  }, [load, loadHistory]);
  return (
    <div className="resume-builder">
      <h1>Resume builder</h1>
      <p className="muted">
        Build your master resume once for matching and skill-gap analysis.
        Hosted bullet coaching is not included in this edition.
      </p>
      {loading ? (
        <p role="status">Loading your resume…</p>
      ) : error ? (
        <div role="alert" className="builder-error">
          <p>{error}</p>
          <button type="button" onClick={() => void load()}>
            Retry loading resume
          </button>
        </div>
      ) : (
        profile && (
          <ResumeForm
            key={draftKey}
            imported={imported}
            onImport={(masterResume) => {
              setProfile(current => current ? { ...current, masterResume } : current);
              setImported(true);
              setDraftKey(key => key + 1);
              requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[name="name"]')?.focus());
            }}
            resume={profile.masterResume ?? emptyResume()}
            version={profile.version}
            onSaved={(version, masterResume) => {
              setImported(false);
              setProfile((current) =>
                current ? { ...current, version, masterResume } : current,
              );
              void loadHistory();
            }}
          />
        )
      )}
      {!loading && !error && profile && <>
        <ReferencesEditor />
        <BuilderInsights key={profile.version} />
      </>}
      <section className="builder-section" aria-labelledby="history-heading">
        <h2 id="history-heading">Saved versions</h2>
        <p className="muted">Scores arrive after background recalculation. ATS averages use existing reports and may not reflect a fresh analysis of that version.</p>
        {historyLoading ? (
          <p role="status">Loading version history…</p>
        ) : historyError ? (
          <>
            <p role="alert">{historyError}</p>
            <button type="button" onClick={() => void loadHistory()}>
              Retry version history
            </button>
          </>
        ) : versions.length === 0 ? (
          <p className="muted">No saved versions yet.</p>
        ) : (
          <ol className="builder-history">
            {versions.map((row) => (
              <li key={row.version}>
                Version {row.version}{" "}
                <time dateTime={row.createdAt}>
                  {new Date(row.createdAt).toLocaleString()}
                </time>
                <div>Profile strength: {formatScore(row.profileStrength)} · Match: {formatScore(row.avgMatchScore)} · ATS: {formatScore(row.avgAtsScore)}</div>
                {row.note && <p>{row.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
