import Link from "next/link";
import { api } from "@/lib/server-api";
import type { Listing, MatchScore } from "@aperture/shared";

export default async function Listings() {
  let rows: { listing: Listing; match: MatchScore | null }[] = [];
  try {
    rows = await api("/listings");
  } catch {
    // empty state
  }

  return (
    <>
      <h1>Listings</h1>
      <p className="muted">Aggregated from LinkedIn RSS + Indeed RSS. Scored against your profile.</p>
      {rows.length === 0 && <div className="card muted">No listings scanned yet.</div>}
      {rows.map(({ listing, match }) => (
        <div className="card" key={listing.id}>
          {match && <span className="score">{Math.round(match.overall)} </span>}
          <Link href={`/listings/${listing.id}`}>
            <strong>{listing.title}</strong>
          </Link>{" "}
          — {listing.company}
          <div className="muted">
            {listing.location ?? "location unspecified"} · {listing.source}
            {match && ` · ${match.verdict.replaceAll("_", " ")}`}
          </div>
        </div>
      ))}
    </>
  );
}
