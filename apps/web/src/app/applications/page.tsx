import { api } from "@/lib/api";

interface ApplicationRow {
  id: string;
  listingId: string;
  status: string;
  appliedAt: string | null;
  notes: string | null;
}

export default async function Applications() {
  let rows: ApplicationRow[] = [];
  try {
    rows = await api<ApplicationRow[]>("/applications");
  } catch {
    // Empty state when the API is not running.
  }

  return (
    <>
      <h1>Applications</h1>
      {rows.length === 0 && <div className="card muted">Nothing tracked yet.</div>}
      {rows.map((application) => (
        <div className="card" key={application.id}>
          <strong>{application.status}</strong>
          {application.appliedAt && <span className="muted"> · applied {application.appliedAt.slice(0, 10)}</span>}
          {application.notes && <div className="muted">{application.notes}</div>}
        </div>
      ))}
    </>
  );
}
