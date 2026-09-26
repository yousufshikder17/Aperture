import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { ApplicationCreateSchema, ApplicationPatchSchema, type Application } from "@aperture/shared";

// Synthetic transport fixture; API ownership and persistence have separate integration tests.
export function applicationFixture(listing: { id: string; title: string; company: string }) {
  const fixture = { readStatus: 200, writeStatus: 200, writes: 0, omitFromCatalog: false, rows: [] as Application[],
    async handle(req: IncomingMessage, res: ServerResponse) {
      const send = (value: unknown, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
      if (req.method === "GET") { send(fixture.rows, fixture.readStatus); return; }
      if (fixture.writeStatus !== 200) { send({}, fixture.writeStatus); return; }
      let text = ""; for await (const chunk of req) text += String(chunk);
      const now = new Date().toISOString();
      if (req.method === "POST") {
        const body = ApplicationCreateSchema.parse(JSON.parse(text));
        fixture.rows.unshift({ id: "00000000-0000-4000-8000-000000000099", ...body, notes: body.notes ?? null,
          createdAt: now, appliedAt: body.status === "applied" ? now : null, events: [{ status: body.status, at: now }], listing });
      } else {
        const body = ApplicationPatchSchema.parse(JSON.parse(text));
        const row = fixture.rows[0]!;
        if (body.status && body.status !== row.status) row.events.push({ status: body.status, at: now });
        Object.assign(row, body);
      }
      fixture.writes++; send(fixture.rows[0], req.method === "POST" ? 201 : 200);
    },
  };
  return fixture;
}

export async function checkApplications({ browser, evaluate, waitFor, origin, captures, listingId, fixture }: {
  browser: (...args: string[]) => Promise<any>; evaluate: (source: string) => Promise<any>;
  waitFor: (source: string) => Promise<unknown>; origin: string; captures: string; listingId: string;
  fixture: ReturnType<typeof applicationFixture>;
}) {
  fixture.omitFromCatalog = true; // Exercise a direct listing outside the latest catalog page.
  fixture.readStatus = 503;
  await browser("open", origin + "/applications?listing=" + listingId);
  await waitFor('document.body.textContent.includes("Retry loading tracker")');
  assert.equal(await evaluate('document.body.textContent.includes("No applications tracked yet")'), false);
  fixture.readStatus = 200;
  await browser("find", "role", "button", "click", "--name", "Retry loading tracker", "--exact");
  await waitFor('document.querySelector("#new-listing") !== null');
  assert.equal(await evaluate('document.querySelector("#new-listing").value'), listingId);
  await browser("fill", "#new-notes", "Follow up on Monday");
  fixture.writeStatus = 503;
  await browser("click", ".application-form button[type=submit]");
  await waitFor('document.querySelector(".application-form [role=alert]") !== null');
  assert.equal(await evaluate('document.querySelector("#new-notes").value'), "Follow up on Monday");
  fixture.writeStatus = 200;
  await browser("click", ".application-form button[type=submit]");
  await waitFor('document.querySelectorAll("article.application-section").length === 1');
  assert.equal(fixture.writes, 1);
  assert.equal(await evaluate('document.body.textContent.includes("requires Pro")'), false);
  await browser("reload");
  await waitFor('document.querySelector("article textarea")?.value === "Follow up on Monday"');
  await browser("select", "article select", "interviewing");
  await browser("click", "article textarea");
  await browser("press", "Control+a");
  await browser("press", "Backspace");
  assert.equal(await evaluate('document.querySelector("article textarea").value'), "");
  fixture.writeStatus = 503;
  await browser("click", "article button[type=submit]");
  await waitFor('document.querySelector("article [role=alert]") !== null');
  assert.equal(await evaluate('document.querySelector("article select").value'), "interviewing");
  assert.equal(fixture.rows[0]!.status, "applied");
  fixture.writeStatus = 200;
  await browser("click", "article button[type=submit]");
  await waitFor('document.querySelector("article [role=status]")?.textContent === "Changes saved."');
  assert.equal(fixture.rows[0]!.notes, ""); assert.equal(fixture.rows[0]!.events.length, 2);
  await browser("fill", "article textarea", "Interview confirmed");
  await browser("click", "article button[type=submit]");
  await waitFor('document.querySelector("article [role=status]")?.textContent === "Changes saved."');
  assert.equal(fixture.rows[0]!.events.length, 2);
  await browser("reload");
  await waitFor('document.querySelector("article textarea")?.value === "Interview confirmed"');
  for (const [name, width, height] of [["desktop", "1440", "1000"], ["mobile", "390", "844"]]) {
    await browser("set", "viewport", width!, height!);
    await evaluate("window.scrollTo(0,0)");
    await browser("screenshot", join(captures, `applications-${name}.png`), "--full");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
  }
  const accessibility = await browser("a11y", "--selector", ".application-tracker");
  assert.equal(accessibility.counts.violations, 0, JSON.stringify(accessibility.violations));
  for (const [status, copy] of [[401, "Sign in through Account"]] as const) {
    fixture.readStatus = status;
    await browser("reload");
    await waitFor(`document.body.textContent.includes(${JSON.stringify(copy)})`);
    assert.equal(await evaluate('document.querySelector(".application-form") === null'), true);
  }
  fixture.readStatus = 200;
  fixture.omitFromCatalog = false;
  console.log("PASS: public application create/edit/retry/reload, notes-only history, access errors, mobile and accessibility.");
}
