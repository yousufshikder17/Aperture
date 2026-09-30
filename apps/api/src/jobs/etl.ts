import { eq } from "drizzle-orm";
import {
  applications,
  db,
  improvementHistory,
  listings,
  matches,
  profiles,
  users,
  type Db,
} from "@aperture/db";
import { analyticsConnection } from "@aperture/analytics";
import { listingSkillTerms, normalize, resumeText, hasKeyword } from "@aperture/ai";

// Postgres → DuckDB ETL. Postgres stays pure OLTP; this job rebuilds the
// analytical fact tables that power gap analysis, response rates, market
// suggestions, and score trajectories. Full refresh — the dataset is small at
// this stage; switch to incremental loads when it isn't.
//
// Listing-skill extraction uses the deterministic heuristic keyword engine
// (no AI): ETL must be cheap enough to run on every schedule tick.

// A status past "applied" that a human at the company chose. Rejection is
// excluded on purpose: response rate here measures CONVERSION (did you advance),
// which is the number the gap analysis explains.
const ADVANCED = new Set(["screening", "interviewing", "offer"]);

function roleTypeFor(listingTitle: string, targetRoles: string[]): string {
  const title = normalize(listingTitle);
  for (const role of targetRoles) {
    const tokens = normalize(role).split(" ").filter((t) => t.length > 2);
    if (tokens.length && tokens.every((t) => hasKeyword(title, t))) return role;
  }
  return "other";
}

function companyTier(): string {
  return "unknown"; // populated by startup intelligence (V2)
}

export async function runEtl(database: Db = db()): Promise<{
  applications: number;
  listingSkills: number;
  snapshots: number;
}> {
  // A separate connection keeps API reads on the previous snapshot until commit.
  const duck = await analyticsConnection();
  await duck.run("BEGIN TRANSACTION");
  try {
  await duck.run("DELETE FROM fact_applications");
  await duck.run("DELETE FROM fact_listing_skills");
  await duck.run("DELETE FROM fact_score_snapshots");

  const allUsers = await database.select().from(users);
  let appCount = 0;
  let skillCount = 0;
  let snapCount = 0;

  for (const user of allUsers) {
    const profileRows = await database.select().from(profiles).where(eq(profiles.userId, user.id));
    const profile = profileRows[0]?.masterResume ?? null;
    const targetRoles = profile?.targetRoles ?? [];
    const haystack = profile ? resumeText(profile) : "";

    // ---- fact_applications ----
    const appRows = await database
      .select()
      .from(applications)
      .innerJoin(listings, eq(listings.id, applications.listingId))
      .where(eq(applications.userId, user.id));

    for (const row of appRows) {
      const app = row.applications;
      const advanced = app.events.find((e) => ADVANCED.has(e.status));
      const responseDays =
        advanced && app.appliedAt
          ? Math.round(
              (new Date(advanced.at).getTime() - app.appliedAt.getTime()) / 86_400_000,
            )
          : null;

      await duck.run(
        `INSERT INTO fact_applications VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          app.id,
          user.id,
          app.listingId,
          roleTypeFor(row.listings.title, targetRoles),
          row.listings.location ?? "unknown",
          companyTier(),
          app.status,
          app.appliedAt?.toISOString() ?? null,
          advanced !== undefined,
          responseDays,
        ],
      );
      appCount++;
    }

    // ---- fact_listing_skills (drives gap analysis + market suggestions) ----
    if (profile) {
      const matchRows = await database
        .select()
        .from(matches)
        .innerJoin(listings, eq(listings.id, matches.listingId))
        .where(eq(matches.userId, user.id));

      for (const row of matchRows) {
        const roleType = roleTypeFor(row.listings.title, targetRoles);
        const terms = listingSkillTerms(
          `${row.listings.title}\n${row.listings.description}`,
          profile,
        );
        for (const term of terms) {
          await duck.run(`INSERT INTO fact_listing_skills VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            row.listings.id,
            user.id,
            roleType,
            term.term,
            term.inDictionary, // dictionary skills count as "required"; loose tokens don't
            hasKeyword(haystack, term.term),
            row.matches.createdAt.toISOString(),
          ]);
          skillCount++;
        }
      }
    }

    // ---- fact_score_snapshots ----
    const snapshots = await database
      .select()
      .from(improvementHistory)
      .where(eq(improvementHistory.userId, user.id));

    for (const snap of snapshots) {
      await duck.run(`INSERT INTO fact_score_snapshots VALUES (?, ?, ?, ?, ?, ?)`, [
        user.id,
        snap.profileVersion,
        snap.profileStrength,
        snap.avgMatchScore,
        snap.avgAtsScore,
        snap.createdAt.toISOString(),
      ]);
      snapCount++;
    }
  }

  await duck.run("COMMIT");
  return { applications: appCount, listingSkills: skillCount, snapshots: snapCount };
  } catch (error) {
    await duck.run("ROLLBACK");
    throw error;
  } finally { duck.closeSync(); }
}

// CLI entry (npm run etl). In production this runs on a schedule after ingest,
// and after recalc bursts.
const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("jobs/etl.ts");
if (isCli) {
  runEtl()
    .then((r) => {
      console.log(
        `etl: ${r.applications} applications, ${r.listingSkills} listing-skill rows, ${r.snapshots} snapshots`,
      );
      process.exit(0);
    })
    .catch((err) => {
      console.error("etl failed:", err);
      process.exit(1);
    });
}
