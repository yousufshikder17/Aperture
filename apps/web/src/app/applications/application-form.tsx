"use client";
import React, { useEffect, useRef, useState } from "react";
import { ApplicationSchema, ApplicationStatusSchema, type Application } from "@aperture/shared";
import { api } from "../../lib/api";
import { useUnsavedChanges } from "../builder/use-unsaved-changes";
import { applicationError, statusLabel } from "./application-data";

export type ListingOption = { id: string; title: string; company: string };
export function ApplicationForm({ application, listings = [], selectedId = "", onSaved }: {
  application?: Application; listings?: ListingOption[]; selectedId?: string;
  onSaved: (row: Application) => void;
}) {
  const [listingId, setListingId] = useState(selectedId);
  const [status, setStatus] = useState(application?.status ?? "applied");
  const [notes, setNotes] = useState(application?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const dirty = application ? status !== application.status || notes !== (application.notes ?? "")
    : !!notes || (!!listingId && listingId !== selectedId) || status !== "applied";
  useUnsavedChanges(dirty || busy);
  useEffect(() => () => request.current?.abort(), []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setMessage("");
    const body = application ? {
      ...(status !== application.status ? { status } : {}),
      ...(notes !== (application.notes ?? "") ? { notes } : {}),
    } : { listingId, status, notes };
    try {
      const row = ApplicationSchema.parse(await api(application ? `/applications/${application.id}` : "/applications", {
        method: application ? "PATCH" : "POST", body: JSON.stringify(body), signal: controller.signal,
      }));
      if (controller.signal.aborted) return;
      onSaved(row);
      setStatus(application ? row.status : "applied"); setNotes(application ? row.notes ?? "" : "");
      if (!application) setListingId("");
      setMessage(application ? "Changes saved." : "Application logged.");
    } catch (cause) { if (!controller.signal.aborted) setError(applicationError(cause)); }
    finally { request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  const prefix = application?.id ?? "new";
  return <form className="application-form" onSubmit={event => void save(event)}>
    <fieldset disabled={busy}>
      <legend className="application-legend">{application ? "Update application" : "Log an application"}</legend>
      {!application && <label htmlFor={`${prefix}-listing`}>Job listing
        <select id={`${prefix}-listing`} value={listingId} required onChange={event => { setListingId(event.target.value); setMessage(""); }}>
          <option value="">Choose a listing</option>
          {listings.map(listing => <option value={listing.id} key={listing.id}>{listing.title} — {listing.company}</option>)}
        </select>
      </label>}
      <label htmlFor={`${prefix}-status`}>Status
        <select id={`${prefix}-status`} value={status} onChange={event => { setStatus(ApplicationStatusSchema.parse(event.target.value)); setMessage(""); }}>
          {ApplicationStatusSchema.options.map(value => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select>
      </label>
      <label htmlFor={`${prefix}-notes`}>Notes <span className="muted">(optional)</span>
        <textarea id={`${prefix}-notes`} rows={3} maxLength={10000} value={notes} onChange={event => { setNotes(event.target.value); setMessage(""); }} />
      </label>
      <button type="submit" disabled={application ? !dirty : !listingId}>{busy ? "Saving…" : application ? "Save changes" : "Log application"}</button>
    </fieldset>
    {error && <p role="alert" className="application-error">{error} <a href="/account">Account</a></p>}
    <p role="status">{message}</p>
  </form>;
}
