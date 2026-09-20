import { api } from "@/lib/server-api";

interface DigestItem {
  listing: { id: string; title: string; company: string; url: string };
  score: number;
  verdict: string;
  strengths: string[];
}

export default async function Home() {
  let digest: DigestItem[] = [];
  try {
    digest = await api<DigestItem[]>("/digest");
  } catch {
    // API not running yet — render the empty state.
  }

  return (
    <>
      <h1>Today&apos;s digest</h1>
      <p className="muted">
        The listings worth applying to today, ranked by how you actually score against them.
      </p>
      {digest.length === 0 && (
        <div className="card muted">
          Nothing yet. Upload your resume on the Profile page, then scan listings.
        </div>
      )}
      {digest.map((d) => (
        <div className="card" key={d.listing.id}>
          <span className="score">{Math.round(d.score)}</span>{" "}
          <strong>{d.listing.title}</strong> — {d.listing.company}
          <div className="muted">{d.verdict.replaceAll("_", " ")}</div>
          <ul>
            {d.strengths.slice(0, 3).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
