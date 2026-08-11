import { api } from "@/lib/api";

interface ResourceRow {
  id: string;
  title: string;
  url: string;
  kind: string;
  skills: string[];
  level: string | null;
  timeCommitment: string | null;
  summary: string | null;
  complexityFlag: string | null;
}

export default async function Resources({
  searchParams,
}: {
  searchParams: Promise<{ skill?: string }>;
}) {
  const { skill } = await searchParams;
  let rows: ResourceRow[] = [];
  try {
    rows = await api<ResourceRow[]>(`/resources${skill ? `?skill=${encodeURIComponent(skill)}` : ""}`);
  } catch {
    // empty state
  }

  return (
    <>
      <h1>Resource director</h1>
      <p className="muted">
        Curated registry, complexity-tagged at index time.
        {skill && ` Filtered by gap: ${skill}.`}
      </p>
      {rows.length === 0 && (
        <div className="card muted">Registry not synced yet — run npm run resources:sync.</div>
      )}
      {rows.map((r) => (
        <div className="card" key={r.id}>
          <a href={r.url}>
            <strong>{r.title}</strong>
          </a>{" "}
          <span className="muted">
            {r.kind}
            {r.level && ` · ${r.level}`}
            {r.timeCommitment && ` · ${r.timeCommitment}`}
          </span>
          {r.summary && <div>{r.summary}</div>}
          <div className="muted">Covers: {r.skills.join(", ")}</div>
          {r.complexityFlag && <div className="flag">{r.complexityFlag}</div>}
        </div>
      ))}
    </>
  );
}
