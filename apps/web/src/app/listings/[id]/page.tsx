import { api } from "@/lib/api";
import type { Listing, MatchScore } from "@aperture/shared";

interface ListingRow {
  listing: Listing;
  match: MatchScore | null;
}

export default async function ListingMatch({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let row: ListingRow | undefined;
  try {
    const rows = await api<ListingRow[]>("/listings");
    row = rows.find((candidate) => candidate.listing.id === id);
  } catch {
    // Render a useful disconnected state when the API is unavailable.
  }

  if (!row) {
    return <div className="card muted">Listing not found or the API is unavailable.</div>;
  }

  return (
    <>
      <h1>{row.listing.title}</h1>
      <p className="muted">{row.listing.company} · {row.listing.location ?? "Location not provided"}</p>
      <div className="card">{row.listing.description}</div>

      <h2>Transparent match</h2>
      {!row.match && (
        <div className="card muted">Run <code>POST /v1/listings/{id}/match</code> to calculate a score.</div>
      )}
      {row.match && (
        <div className="card">
          <span className="score">{Math.round(row.match.overall)}</span>{" "}
          <strong>{row.match.verdict.replaceAll("_", " ")}</strong>
          <p>{row.match.rationale}</p>
          <div>Skills {row.match.subscores.skills} · Experience {row.match.subscores.experience} · Seniority {row.match.subscores.seniority} · Location {row.match.subscores.location}</div>
          <p className="muted">Missing or weakly demonstrated: {row.match.concerns.join(", ") || "none detected"}</p>
        </div>
      )}
    </>
  );
}
