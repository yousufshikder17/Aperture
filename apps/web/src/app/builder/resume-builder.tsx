"use client";

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  MasterResumeSchema,
  BulletSuggestionSchema,
  type MasterResume,
  type BulletSuggestion,
} from "@aperture/shared";
import { api, ApiError, UpgradeRequiredError } from "../../lib/api";
import { emptyResume, resumeFromForm } from "./form-data";

type Profile = { masterResume: MasterResume | null; version: number };
type Version = { version: number; createdAt: string };

function message(error: unknown, fallback: string) {
  if (error instanceof UpgradeRequiredError)
    return "Your coaching allowance is used up. You can still edit and save manually.";
  if (error instanceof ApiError && error.status === 401)
    return "Authentication is required. Check your configured sign-in or local development credential, then retry.";
  if (error instanceof ApiError && error.status === 403)
    return "Your account does not have access to this action.";
  if (error instanceof ApiError && error.status === 501)
    return "Bullet coaching is disabled. You can still edit and save manually.";
  return fallback;
}

function Field({
  name,
  label,
  value,
  multiline = false,
  required = false,
  type = "text",
  hint,
}: {
  name: string;
  label: string;
  value?: string | null;
  multiline?: boolean;
  required?: boolean;
  type?: string;
  hint?: string;
}) {
  const id = useId();
  const props = {
    id,
    name,
    defaultValue: value ?? "",
    required,
    pattern: required && type === "text" ? ".*\\S.*" : undefined,
    "aria-describedby": hint ? `${id}-hint` : undefined,
  };
  return (
    <div className="builder-field">
      <label htmlFor={id}>
        {label}
        {required ? " (required)" : ""}
      </label>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {multiline ? (
        <textarea {...props} rows={3} />
      ) : (
        <input {...props} type={type} />
      )}
    </div>
  );
}

function Collection<T>({
  name,
  title,
  singular,
  initial,
  create,
  dirty,
  children,
}: {
  name: string;
  title: string;
  singular: string;
  initial: T[];
  create: () => T;
  dirty: () => void;
  children: (value: T, prefix: string) => ReactNode;
}) {
  const [rows, setRows] = useState(() =>
    initial.map((value, id) => ({ value, id })),
  );
  const nextId = useRef(initial.length);
  const section = useRef<HTMLElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  return (
    <section ref={section} className="builder-section" aria-label={title}>
      <h2>{title}</h2>
      {rows.length === 0 && (
        <p className="muted">
          No {title.toLowerCase()} added. Add only what belongs on your resume.
        </p>
      )}
      {rows.map(({ value, id }, index) => (
        <fieldset className="builder-entry" key={id}>
          <legend>
            {singular} {index + 1}
          </legend>
          <input type="hidden" name={name} value={id} />
          <div className="builder-grid">{children(value, `${name}.${id}`)}</div>
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  `Remove this ${singular.toLowerCase()} from your draft? This is saved only when you save the resume.`,
                )
              )
                return;
              setRows((current) => current.filter((row) => row.id !== id));
              dirty();
              addButton.current?.focus();
            }}
          >
            Remove {singular.toLowerCase()} {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        ref={addButton}
        type="button"
        onClick={() => {
          const id = nextId.current++;
          setRows((current) => [...current, { value: create(), id }]);
          dirty();
          requestAnimationFrame(() =>
            section.current
              ?.querySelector<HTMLElement>(
                ":scope > fieldset:last-of-type input:not([type=hidden]), :scope > fieldset:last-of-type textarea",
              )
              ?.focus(),
          );
        }}
      >
        Add {singular.toLowerCase()}
      </button>
    </section>
  );
}

function Bullet({
  name,
  initial,
  dirty,
}: {
  name: string;
  initial: string;
  dirty: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [suggestion, setSuggestion] = useState<BulletSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const revision = useRef(0);
  const pending = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );

  async function review() {
    if (pending.current || !value.trim()) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setSuggestion(null);
    const requested = revision.current;
    try {
      const result = BulletSuggestionSchema.parse(
        await api("/builder/improve-bullet", {
          method: "POST",
          body: JSON.stringify({ bullet: value }),
        }),
      );
      if (requested === revision.current) setSuggestion(result);
    } catch (cause) {
      if (requested === revision.current)
        setError(
          message(
            cause,
            "Coaching could not finish. Your bullet is unchanged; try again or continue manually.",
          ),
        );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="builder-bullet">
      <label htmlFor={id}>Resume bullet</label>
      <textarea
        ref={input}
        id={id}
        name={name}
        rows={3}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          revision.current++;
          setSuggestion(null);
          setError("");
          dirty();
        }}
      />
      <button type="button" disabled={busy || !value.trim()} onClick={review}>
        {busy ? "Reviewing bullet…" : "Review bullet"}
      </button>
      {error && (
        <p role="alert" className="builder-error">
          {error}
        </p>
      )}
      {suggestion && (
        <div className="builder-suggestion" aria-label="Bullet suggestion">
          <h3>Suggested wording — review before applying</h3>
          <p>{suggestion.rewrite}</p>
          <p className="muted">{suggestion.rationale}</p>
          {suggestion.issues.length > 0 && (
            <ul>
              {suggestion.issues.map((issue, i) => (
                <li key={i}>{issue.note}</li>
              ))}
            </ul>
          )}
          {suggestion.metricPrompts.length > 0 && (
            <>
              <h3>Details only you can supply</h3>
              <ul>
                {suggestion.metricPrompts.map((prompt, i) => (
                  <li key={i}>{prompt}</li>
                ))}
              </ul>
            </>
          )}
          <p className="muted">
            Check every fact and replace any placeholders. Nothing is applied
            automatically.
          </p>
          <button
            type="button"
            onClick={() => {
              setValue(suggestion.rewrite);
              revision.current++;
              setSuggestion(null);
              dirty();
              input.current?.focus();
            }}
          >
            Apply suggested wording
          </button>{" "}
          <button
            type="button"
            onClick={() => {
              setSuggestion(null);
              input.current?.focus();
            }}
          >
            Keep my wording
          </button>
        </div>
      )}
    </div>
  );
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
            <Bullet name={`${prefix}.bullets`} initial={value} dirty={dirty} />
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
}: {
  resume: MasterResume;
  version: number;
  onSaved: (version: number) => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const pending = useRef(false);
  const errorBox = useRef<HTMLParagraphElement>(null);
  const changed = () => {
    setDirty(true);
    setSaved("");
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: MouseEvent) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (
        link &&
        !window.confirm("Leave the builder and discard your unsaved changes?")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);

  return (
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
          onSaved(result.version);
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
      <fieldset disabled={saving} className="builder-fields">
        <legend className="builder-sr-only">Resume details</legend>
        <section className="builder-section" aria-labelledby="basics-heading">
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
              hint="One role per line."
            />
          </div>
          <Field
            name="summary"
            label="Summary"
            value={resume.summary}
            multiline
          />
        </section>
        <Collection
          name="links"
          title="Links"
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
          className="builder-section"
          aria-labelledby="additional-heading"
        >
          <h2 id="additional-heading">Additional details</h2>
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
  );
}

export default function ResumeBuilder() {
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
      const rows = await api<Version[]>("/builder/versions", { signal });
      if (!Array.isArray(rows) || rows.some(row => !row || !Number.isInteger(row.version) || row.version < 1 || typeof row.createdAt !== "string" || !Number.isFinite(Date.parse(row.createdAt)))) {
        throw new Error("Invalid version history");
      }
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
        Build your master resume once. Matching, recruiter intelligence, and
        tailoring use this profile. Bullet coaching is optional.
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
            resume={profile.masterResume ?? emptyResume()}
            version={profile.version}
            onSaved={(version) => {
              setProfile((current) =>
                current ? { ...current, version } : current,
              );
              void loadHistory();
            }}
          />
        )
      )}
      <section className="builder-section" aria-labelledby="history-heading">
        <h2 id="history-heading">Saved versions</h2>
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
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
