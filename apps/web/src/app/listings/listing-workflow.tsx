"use client";
import React, { useEffect, useRef, useState } from "react";
import { ListingRowSchema, ListingRowsSchema, type ListingRow, type ListingRows } from "@aperture/shared";
import { api } from "../../lib/api";
import { listingError, safeListingUrl, scanSummary } from "./listing-data";
import { MatchReport } from "./listing-report";

function Recovery({ error }: { error: string }) {
  return error ? <div role="alert" className="listing-error"><p>{error}</p>
    <p><a href="/account">Account</a> · <a href="/builder">Resume builder</a></p></div> : null;
}

export function ListingsWorkflow() {
  const [rows, setRows] = useState<ListingRows | null>(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  async function load(scan = false) {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(scan ? "scan" : "load"); setError(""); setStatus("");
    try {
      if (scan) {
        const message = scanSummary(await api("/listings/scan", { method: "POST", signal: controller.signal }));
        if (!controller.signal.aborted) setStatus(message);
      }
      const data = ListingRowsSchema.parse(await api("/listings", { signal: controller.signal }));
      if (!controller.signal.aborted) setRows(data);
    } catch (e) { if (!controller.signal.aborted) setError(listingError(e)); }
    finally { if (request.current === controller) { request.current = null; setBusy(""); } }
  }
  useEffect(() => { void load(); return () => { request.current?.abort(); request.current = null; }; }, []);
  return <div className="listing-workflow">
    <h1>Listings</h1>
    <p>Scan the operator-configured LinkedIn and Indeed RSS feeds, then open a listing to score your saved resume. Scanning the shared catalog requires an administrator.</p>
    <div className="listing-actions">
      <button className="listing-primary" disabled={!!busy} onClick={() => void load(true)}>{busy === "scan" ? "Scanning feeds…" : "Scan configured feeds (admin)"}</button>
      <button disabled={!!busy} onClick={() => void load()}>{busy === "load" ? "Loading listings…" : "Refresh listings"}</button>
    </div>
    <p role="status">{status}</p><Recovery error={error} />
    {rows?.length === 0 && <p className="listing-section">No listings yet. Scan configured feeds to get started.</p>}
    {!!rows?.length && <p className="muted">Showing the latest {rows.length} {rows.length === 1 ? "listing" : "listings"}, up to 100. Match scores reflect the saved version noted below, not unsaved edits.</p>}
    {rows?.map(({ listing, match, profileVersion }) => <article className="listing-section" key={listing.id}>
      <h2><a href={`/listings/${encodeURIComponent(listing.id)}`}>{listing.title}</a></h2>
      <p>{listing.company} · {listing.location ?? "Location unspecified"}</p>
      <p className="muted">{listing.source.replaceAll("_", " ")}{listing.salary && ` · ${listing.salary}`}</p>
      <p>{match ? `Match: ${match.overall.toFixed(1)} / 100 — ${match.verdict.replaceAll("_", " ")}${profileVersion ? ` (resume version ${profileVersion})` : ""}` : "Not scored yet"}</p>
    </article>)}
  </div>;
}


export function ListingWorkflow({ id }: { id: string }) {
  const [row, setRow] = useState<ListingRow | null>(null);
  const [busy, setBusy] = useState("load");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  const path = `/listings/${encodeURIComponent(id)}`;
  async function run(action: "load" | "match") {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(action); setError(""); setStatus("");
    try {
      let result: ListingRow;
      if (action === "match" && row) {
        const saved = await api<{ score: unknown; profileVersion: unknown }>(path + "/match", { method: "POST", signal: controller.signal });
        result = ListingRowSchema.parse({ listing: row.listing, match: saved.score, profileVersion: saved.profileVersion });
      } else result = ListingRowSchema.parse(await api(path, { signal: controller.signal }));
      if (!controller.signal.aborted) { setRow(result); if (action === "match") setStatus("Match scored and saved."); }
    } catch (e) { if (!controller.signal.aborted) setError(listingError(e)); }
    finally { if (request.current === controller) { request.current = null; setBusy(""); } }
  }
  useEffect(() => { void run("load"); return () => { request.current?.abort(); request.current = null; }; }, [id]);
  const externalUrl = row && safeListingUrl(row.listing.url);
  return <div className="listing-workflow">
    <a href="/listings">Back to listings</a>
    <h1>{row?.listing.title ?? "Listing match"}</h1>
    {row && <><p>{row.listing.company} · {row.listing.location ?? "Location unspecified"}{row.listing.salary && ` · ${row.listing.salary}`}</p>
      {externalUrl && <p><a href={externalUrl} target="_blank" rel="noopener noreferrer">Open original posting (new tab)</a></p>}
      <details className="listing-section"><summary>Read listing description</summary>
        <p className="listing-description">{row.listing.description || "No description provided."}</p>
      </details></>}
    <p>Match scoring uses your saved master resume, not unsaved builder edits. Scores are calculated locally without hosted AI analysis.</p>
    <p className="muted">Scoring uses your account allowance. Saved scores may predate your latest profile edits; score again when needed.</p>
    <div className="listing-actions">
      <button disabled={!!busy} onClick={() => void run("load")}>{busy === "load" ? "Loading listing…" : "Reload saved match"}</button>
      <button className="listing-primary" disabled={!!busy || !row} onClick={() => void run("match")}>{busy === "match" ? "Scoring match…" : "Score match"}</button>
    </div>
    <p role="status">{status}</p><Recovery error={error} />
    {row?.match ? <MatchReport score={row.match} version={row.profileVersion} /> :
      row && !busy && !error && <p>No saved match yet. Choose Score match to calculate one.</p>}
  </div>;
}
