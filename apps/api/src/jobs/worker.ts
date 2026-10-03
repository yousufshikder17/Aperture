import { eq } from "drizzle-orm";
import { users } from "@aperture/db";
import { scanFeeds } from "../services/aggregator.js";
import { syncRegistry } from "../services/resource-sync.js";
import { buildDigest, deliverDigest, digestRecipients } from "./digest.js";
import { runEtl } from "./etl.js";
import { recalcUser } from "./recalc.js";
import { enqueueJob, runNextJob, type Job, type JobTransaction } from "./queue.js";
import { scheduleJobs } from "./scheduler.js";

export async function handleJob(job: Job, tx: JobTransaction) {
  switch (job.kind) {
    case "recalc": return recalcUser(job.payload.userId!, tx);
    case "ingest": {
      const result = await scanFeeds({ context: { runId: job.id } });
      if (result.failedSources.length) throw new Error("FeedUnavailable");
      return;
    }
    case "resource-sync": await syncRegistry(); return;
    case "etl": await runEtl(); return;
    case "digest": {
      for (const id of digestRecipients()) {
        const [user] = await tx.select().from(users).where(eq(users.id, id));
        if (!user || user.authSubject?.startsWith("development:")) continue;
        const entries = await buildDigest(id, 10, tx);
        if (!entries.length) continue;
        await enqueueJob(tx, `${job.id}:${id}`, "digest-delivery", {
          userId: id, to: user.email, from: process.env.DIGEST_FROM!,
          text: entries.map(entry => `${entry.listing.title} — ${entry.listing.company}\n` +
            `Match: ${entry.score}/100 (${entry.verdict.replaceAll("_", " ")})\n${entry.listing.url}\n`).join("\n"),
        });
      }
      return;
    }
    case "digest-delivery": {
      // Re-check enrollment and identity so a queued message cannot outlive an opt-out.
      if (!digestRecipients().includes(job.payload.userId!)) return;
      const [user] = await tx.select().from(users).where(eq(users.id, job.payload.userId!));
      if (!user || user.email !== job.payload.to || user.authSubject?.startsWith("development:")) return;
      await deliverDigest(job); return;
    }
    default: throw new Error("UnknownJobKind");
  }
}

export function startBackgroundWorker() {
  digestRecipients(); // Fail configuration errors before serving requests.
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let lastSchedule = 0;
  async function tick() {
    try {
      if (Date.now() - lastSchedule >= 60_000) { await scheduleJobs(); lastSchedule = Date.now(); }
      while (!stopped && await runNextJob(handleJob)) {
        if (Date.now() - lastSchedule >= 60_000) { await scheduleJobs(); lastSchedule = Date.now(); }
      }
    } catch { console.error("Background worker unavailable; retrying in 2 seconds"); }
    finally { if (!stopped) { timer = setTimeout(() => void tick(), 2000); timer.unref(); } }
  }
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
