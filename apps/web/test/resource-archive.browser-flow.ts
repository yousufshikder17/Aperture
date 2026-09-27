import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { ArchiveSaveSchema, ArchivePatchSchema, type ArchiveEntry } from "@aperture/shared";

export function archiveFixture() {
  const resource = { id: "sql", title: "SQL basics", url: "https://example.test/sql", kind: "course", skills: ["SQL"],
    level: "beginner", timeCommitment: "hours", summary: "Learn joins and queries.", complexityFlag: null };
  const fixture = { resource, readStatus: 200, writeStatus: 200, saves: 0, rows: [] as ArchiveEntry[],
    async handle(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url!, "http://localhost");
      const send = (body: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      if (url.pathname === "/v1/resources") { send([resource]); return; }
      if (req.method === "GET") { send(fixture.rows, fixture.readStatus); return; }
      if (fixture.writeStatus !== 200) { send({}, fixture.writeStatus); return; }
      let text = ""; for await (const chunk of req) text += String(chunk);
      if (req.method === "POST") {
        const body = ArchiveSaveSchema.parse(JSON.parse(text));
        if (fixture.rows.some(row => row.resourceId === body.resourceId)) { send({}, 409); return; }
        const now = new Date().toISOString();
        fixture.rows.push({ id: "00000000-0000-4000-8000-000000000088", resourceId: body.resourceId,
          progress: "not_started", notes: body.notes ?? null, savedAt: now, updatedAt: now, resource });
        fixture.saves++; send(fixture.rows[0], 201); return;
      }
      Object.assign(fixture.rows[0]!, ArchivePatchSchema.parse(JSON.parse(text)), { updatedAt: new Date().toISOString() });
      send(fixture.rows[0]);
    },
  };
  return fixture;
}

export async function checkArchive({ browser, evaluate, waitFor, origin, captures, fixture }: {
  browser: (...args: string[]) => Promise<any>; evaluate: (source: string) => Promise<any>;
  waitFor: (source: string) => Promise<unknown>; origin: string; captures: string; fixture: ReturnType<typeof archiveFixture>;
}) {
  fixture.readStatus = 503;
  await browser("open", origin + "/resources?skill=SQL&level=beginner");
  await waitFor('document.body.textContent.includes("Retry archive check")');
  assert.equal(await evaluate('document.querySelector("article button").disabled'), true);
  fixture.readStatus = 200;
  await browser("find", "role", "button", "click", "--name", "Retry archive check", "--exact");
  await waitFor('document.querySelector("article button")?.disabled === false');
  for (const [status, message] of [[503, "Please retry"], [402, "allowance is exhausted"]] as const) {
    fixture.writeStatus = status;
    await browser("click", "article button");
    await waitFor(`document.querySelector("article [role=alert]")?.textContent.includes(${JSON.stringify(message)})`);
    assert.equal(fixture.saves, 0);
  }
  fixture.writeStatus = 200;
  await browser("click", "article button");
  await waitFor('document.querySelector("article button")?.textContent === "Saved to archive"');
  assert.equal(fixture.saves, 1);
  await browser("reload");
  await waitFor('document.querySelector("article button")?.textContent === "Saved to archive"');
  assert.equal(await evaluate('document.querySelector("[name=skill]").value'), "SQL");
  const saved = fixture.rows[0]!;
  fixture.rows = []; await browser("reload");
  await waitFor('document.querySelector("article button")?.disabled === false');
  fixture.rows = [saved]; // Another tab saved after this page checked the archive.
  await browser("click", "article button");
  await waitFor('document.querySelector("article button")?.textContent === "Saved to archive"');
  assert.equal(fixture.saves, 1, "duplicate retry does not add another record");
  fixture.readStatus = 503;
  await browser("open", origin + "/resources/archive");
  await waitFor('document.body.textContent.includes("Retry loading archive")');
  assert.equal(await evaluate('document.body.textContent.includes("No saved resources yet")'), false);
  fixture.readStatus = 200;
  await browser("find", "role", "button", "click", "--name", "Retry loading archive", "--exact");
  await waitFor('document.querySelector("article textarea") !== null');
  await browser("select", "article select", "in_progress");
  await browser("fill", "article textarea", "Finished chapter one");
  fixture.writeStatus = 503;
  await browser("click", "article button");
  await waitFor('document.querySelector("article [role=alert]") !== null');
  assert.equal(await evaluate('document.querySelector("article textarea").value'), "Finished chapter one");
  fixture.writeStatus = 200;
  await browser("click", "article button");
  await waitFor('document.querySelector("article [role=status]")?.textContent === "Changes saved."');
  await browser("reload");
  await waitFor('document.querySelector("article textarea")?.value === "Finished chapter one"');
  assert.equal(await evaluate('document.querySelector("article select").value'), "in_progress");
  await browser("select", "article select", "completed");
  await evaluate('document.querySelector("article textarea").scrollIntoView({ block: "center" }); document.querySelector("article textarea").focus()');
  await waitFor('document.activeElement === document.querySelector("article textarea")');
  await browser("press", "Control+a"); await browser("press", "Backspace");
  await waitFor('document.querySelector("article textarea")?.value === ""');
  await browser("click", "article button");
  await waitFor('document.querySelector("article [role=status]")?.textContent === "Changes saved."');
  assert.equal(fixture.rows[0]!.notes, ""); assert.equal(fixture.rows[0]!.progress, "completed");
  await browser("reload");
  await waitFor('document.querySelector("article select")?.value === "completed"');
  for (const [name, width, height] of [["desktop", "1440", "1000"], ["mobile", "390", "844"]]) {
    await browser("set", "viewport", width!, height!); await evaluate("window.scrollTo(0,0)");
    await browser("screenshot", join(captures, `archive-${name}.png`), "--full");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  }
  const a11y = await browser("a11y", "--selector", ".resource-workflow");
  assert.equal(a11y.counts.violations, 0, JSON.stringify(a11y.violations));
  fixture.readStatus = 401; await browser("reload");
  await waitFor('document.body.textContent.includes("Sign in through Account")');
  assert.equal(await evaluate('document.querySelector(".archive-editor") === null'), true);
  fixture.readStatus = 200;
  console.log("PASS: resource save/quota/duplicate recovery, archive load/edit/retry/reload, notes clearing, completion, mobile and accessibility.");
}
