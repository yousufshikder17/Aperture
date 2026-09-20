"use client";
import { useId, useRef, useState, type ReactNode } from "react";

export function Field({
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

export function Collection<T>({
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
                  `Remove this ${singular.toLowerCase()} from your draft? This takes effect only when you save this form.`,
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
