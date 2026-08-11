import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

// DuckDB is the OLAP side: response rates, skill-gap frequency, score
// trajectories, cohort aggregates. Fed by ETL from Postgres (jobs/etl in the
// API); Postgres stays pure OLTP.

let _conn: DuckDBConnection | null = null;

export async function analyticsDb(): Promise<DuckDBConnection> {
  if (_conn) return _conn;
  const instance = await DuckDBInstance.create(process.env.DUCKDB_PATH ?? "./analytics.duckdb");
  _conn = await instance.connect();
  await migrate(_conn);
  return _conn;
}

async function migrate(conn: DuckDBConnection) {
  await conn.run(`
    CREATE TABLE IF NOT EXISTS fact_applications (
      application_id UUID, user_id UUID, listing_id UUID,
      role_type TEXT, market TEXT, company_tier TEXT,
      status TEXT, applied_at TIMESTAMP, responded BOOLEAN, response_days INTEGER
    );
    CREATE TABLE IF NOT EXISTS fact_listing_skills (
      listing_id UUID, user_id UUID, role_type TEXT,
      skill TEXT, required BOOLEAN, user_has BOOLEAN, scanned_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS fact_score_snapshots (
      user_id UUID, profile_version INTEGER,
      profile_strength DOUBLE, avg_match_score DOUBLE, avg_ats_score DOUBLE,
      snapshot_at TIMESTAMP
    );
  `);
}

/** Response rate by role type x market x company tier (Application Intelligence). */
export async function responseRates(userId: string) {
  const conn = await analyticsDb();
  const reader = await conn.runAndReadAll(
    `SELECT role_type, market, company_tier,
            count(*) AS applications,
            sum(CASE WHEN responded THEN 1 ELSE 0 END) AS responses,
            round(100.0 * sum(CASE WHEN responded THEN 1 ELSE 0 END) / count(*), 1) AS response_rate_pct
     FROM fact_applications
     WHERE user_id = ? AND applied_at IS NOT NULL
     GROUP BY 1, 2, 3
     ORDER BY applications DESC`,
    [userId],
  );
  return reader.getRowObjects();
}
/**
 * Skill-gap frequency across all scanned listings for a user — powers
 * "73% of ML roles you're targeting require PyTorch; your profile doesn't show this"
 * and the improvement-roadmap ranking.
 */
export async function skillGapFrequency(userId: string) {
  const conn = await analyticsDb();
  const reader = await conn.runAndReadAll(
    `SELECT skill, role_type,
            count(*) AS listings_requiring,
            (SELECT count(DISTINCT listing_id) FROM fact_listing_skills WHERE user_id = ?) AS listings_total,
            round(100.0 * count(*) /
              nullif((SELECT count(DISTINCT listing_id) FROM fact_listing_skills WHERE user_id = ?), 0), 1)
              AS frequency_pct
     FROM fact_listing_skills
     WHERE user_id = ? AND required AND NOT user_has
     GROUP BY skill, role_type
     ORDER BY listings_requiring DESC`,
    [userId, userId, userId],
  );
  return reader.getRowObjects();
}

/** Score improvement over time (Learning + Improvement layer). */
export async function scoreTrajectory(userId: string) {
  const conn = await analyticsDb();
  const reader = await conn.runAndReadAll(
    `SELECT profile_version, profile_strength, avg_match_score, avg_ats_score, snapshot_at
     FROM fact_score_snapshots
     WHERE user_id = ?
     ORDER BY snapshot_at`,
    [userId],
  );
  return reader.getRowObjects();
}

// All public analytical queries are scoped to a verified user ID by their callers.
