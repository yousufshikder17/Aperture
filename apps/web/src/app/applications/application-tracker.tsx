"use client";
import React, { useEffect, useRef, useState } from "react";
import { ApplicationSchema, ListingRowsSchema, ListingRowSchema, type Application } from "@aperture/shared";
import { api } from "../../lib/api";
import { ApplicationForm, type ListingOption } from "./application-form";
import { applicationError, statusLabel } from "./application-data";

export default function ApplicationTracker({ selectedId = "" }: { selectedId?: string }) {
  const [rows, setRows] = useState<Application[] | null>(null);
  const [listings, setListings] = useState<ListingOption[] | null>(null);
  const [error, setError] = useState("");
  const [listingError, setListingError] = useState("");
  const [busy, setBusy] = useState(true);
  const request = useRef<AbortController | null>(null);
  async function load() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setListingError("");
    try {
      const data = ApplicationSchema.array().parse(await api("/applications", { signal: controller.signal }));
      if (controller.signal.aborted) return;
      setRows(data);
      try {
        const found = ListingRowsSchema.parse(await api("/listings", { signal: controller.signal })).map(row => row.listing);
        if (selectedId && !found.some(row => row.id === selectedId))
          found.unshift(ListingRowSchema.parse(await api(`/listings/${encodeURIComponent(selectedId)}`, { signal: controller.signal })).listing);
        if (!controller.signal.aborted) setListings(found);
      } catch (cause) { if (!controller.signal.aborted) setListingError(applicationError(cause)); }
    } catch (cause) { if (!controller.signal.aborted) setError(applicationError(cause)); }
    finally { if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, [selectedId]);
  return <div className="application-tracker">
    <h1>Applications</h1>
    <p>Keep track of your applications, next steps, and conversations.</p>
    <p className="muted">Log a scanned listing below, or open a job in <a href="/listings">Listings</a> and choose Track application.</p>
    {busy && <p role="status">Loading tracker…</p>}
    {error && <div role="alert" className="application-error"><p>{error} <a href="/account">Account</a></p>
      <button disabled={busy} onClick={() => void load()}>Retry loading tracker</button></div>}
    {rows !== null && <>
      <section aria-label="Log application" className="application-section">
        {listingError && <div role="alert"><p>Could not load job choices. {listingError}</p>
          <button disabled={busy} onClick={() => void load()}>Retry job choices</button></div>}
        {listings?.length === 0 && <p>No job listings yet. Ask an administrator to scan feeds, then <a href="/listings">browse listings</a> to start tracking.</p>}
        {!!listings?.length && <ApplicationForm listings={listings} selectedId={selectedId} onSaved={row => setRows(current => [row, ...(current ?? [])])} />}
      </section>
      <h2>Tracked applications ({rows.length})</h2>
      {rows.length === 0 && <p>No applications tracked yet. Log your first application above.</p>}
      {rows.map(row => <article className="application-section" key={row.id} aria-label={`${row.listing.title} at ${row.listing.company}`}>
        <h3><a href={`/listings/${row.listingId}`}>{row.listing.title}</a></h3>
        <p>{row.listing.company} · {statusLabel(row.status)}</p>
        <p className="muted">{row.appliedAt ? `Applied ${row.appliedAt.slice(0, 10)}` : "Not marked as applied"}</p>
        <ApplicationForm application={row} onSaved={saved => setRows(current => current!.map(item => item.id === saved.id ? saved : item))} />
        <details><summary>Status history</summary><ol>{row.events.map((event, index) =>
          <li key={index}>{statusLabel(event.status)} · {event.at.slice(0, 10)}</li>)}</ol></details>
      </article>)}
    </>}
  </div>;
}
