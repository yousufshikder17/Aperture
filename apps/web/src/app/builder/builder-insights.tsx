"use client";
import React, { useEffect, useRef, useState } from "react";
import { MarketSuggestionSchema, type MarketSuggestion } from "@aperture/shared";
import { api } from "../../lib/api";

export const formatScore = (value: number | null | undefined) =>
  value == null ? "Pending / unavailable" : value.toFixed(1) + " / 100";

export default function BuilderInsights() {
  const [market, setMarket] = useState<MarketSuggestion[] | null>(null);
  const [marketError, setMarketError] = useState("");
  const [marketBusy, setMarketBusy] = useState(false);
  const marketRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; marketRequest.current?.abort(); };
  }, []);
  async function loadMarket() {
    if (marketRequest.current) return;
    const controller = new AbortController();
    marketRequest.current = controller;
    setMarketBusy(true); setMarketError(""); setMarket(null);
    try {
      const result = MarketSuggestionSchema.array().parse(await api("/builder/market-suggestions", { signal: controller.signal }));
      if (mounted.current) setMarket(result);
    } catch {
      if (mounted.current) setMarketError("Market suggestions are unavailable. Retry after listings are scanned and analytics are refreshed.");
    } finally { marketRequest.current = null; if (mounted.current) setMarketBusy(false); }
  }
  return <>
    <section className="builder-section" aria-labelledby="market-heading">
      <h2 id="market-heading">Market suggestions</h2>
      <p className="muted">Missing skills from scanned listings matching your saved target roles. These use the latest analytics refresh, not live market data. Add only skills you can demonstrate.</p>
      <button type="button" disabled={marketBusy} onClick={() => void loadMarket()}>{marketBusy ? "Loading suggestions…" : "Load market suggestions"}</button>
      {marketBusy && <p role="status">Loading scanned-listing data…</p>}
      {marketError && <p role="alert" className="builder-error">{marketError}</p>}
      {market && (market.length ? <ul>{market.map((row, i) => <li key={i}>
        <strong>{row.skill}</strong> ({row.role_type || "Unspecified role"}): {row.listings_requiring} of {row.listings_total} scanned listings
        {row.frequency_pct === null ? "" : ` (${row.frequency_pct.toFixed(1)}%)`}.{" "}
        <a href={"/resources?skill=" + encodeURIComponent(row.skill)}>Find learning resources</a>
      </li>)}</ul> : <p role="status">No missing skills were found in the available scanned-listing data. This does not establish readiness for every role.</p>)}
    </section>
  </>;
}
