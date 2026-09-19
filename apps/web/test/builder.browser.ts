// Opt-in browser regression against synthetic API responses. No real database,
// identity provider, resume, or paid AI service is contacted.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MasterResumeSchema } from "@aperture/shared";
import { emptyResume } from "../src/app/builder/form-data.js";

async function main() {
  const session = `aperture-builder-test-${process.pid}`;
  const browserBinary =
    process.env.AGENT_BROWSER_BIN ??
    (process.platform === "win32"
      ? join(
          process.env.APPDATA ?? "",
          "npm/node_modules/agent-browser/bin/agent-browser-win32-x64.exe",
        )
      : "agent-browser");
  if (process.platform === "win32" && !existsSync(browserBinary))
    throw new Error(
      "Install agent-browser or set AGENT_BROWSER_BIN to its native executable.",
    );
  const webPort = Number(process.env.BUILDER_TEST_PORT ?? 3109);
  const webOrigin = `http://127.0.0.1:${webPort}`;
  let profile = { masterResume: emptyResume(), version: 1 };
  profile.masterResume.basics.name = "Synthetic Candidate";
  profile.masterResume.basics.email = "candidate@example.test";
  profile.masterResume.awards = ["Synthetic award"];
  profile.masterResume.experience = [
    {
      company: "Example",
      title: "Developer",
      start: "2024-01",
      end: null,
      location: null,
      skills: [],
      bullets: ["Built a parser"],
    },
  ];
  let profileStatus = 200,
    saveStatus = 200,
    coachStatus = 200;
  let writes = 0,
    coachingCalls = 0,
    historyFails = false;
  const apiServer = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", webOrigin);
    res.setHeader("Access-Control-Allow-Headers", "authorization,content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,PUT,POST,OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const send = (value: unknown, status = 200) => {
      res
        .writeHead(status, { "Content-Type": "application/json" })
        .end(JSON.stringify(value));
    };
    if (req.headers.authorization !== "Bearer synthetic-builder-test") {
      send({ error: "unauthorized" }, 401);
      return;
    }
    try {
      if (req.url === "/v1/profile" && req.method === "GET") {
        send(profile, profileStatus);
        return;
      }
      if (req.url === "/v1/builder/versions") {
        send(
          [{ version: profile.version, createdAt: "2026-09-18T12:00:00.000Z" }],
          historyFails ? 503 : 200,
        );
        return;
      }
      let body = "";
      for await (const chunk of req) body += String(chunk);
      if (req.url === "/v1/profile" && req.method === "PUT") {
        writes++;
        if (saveStatus !== 200) {
          send({ error: "synthetic_save_failure" }, saveStatus);
          return;
        }
        profile = {
          masterResume: MasterResumeSchema.parse(JSON.parse(body)),
          version: profile.version + 1,
        };
        send(profile);
        return;
      }
      if (req.url === "/v1/builder/improve-bullet") {
        coachingCalls++;
        const { bullet } = JSON.parse(body);
        await delay(400);
        send(
          {
            original: bullet,
            rewrite: "Built and maintained a parser",
            issues: [],
            metricPrompts: ["What inputs did it handle?"],
            rationale: "Synthetic coaching fixture.",
          },
          coachStatus,
        );
        return;
      }
      send({ error: "not_found" }, 404);
    } catch {
      if (!res.headersSent) send({ error: "invalid_fixture_request" }, 400);
    }
  });
  await new Promise<void>((resolveListen) =>
    apiServer.listen(0, "127.0.0.1", resolveListen),
  );
  const address = apiServer.address();
  assert(address && typeof address !== "string");
  let web: ChildProcess | undefined;
  let webLog = "";
  const browserProcesses = new Set<ChildProcess>();
  // Some Windows daemon launches retain their stdout handle. The JSON result,
  // rather than EOF from the daemon, marks command completion.
  async function browser(...args: string[]): Promise<any> {
    return new Promise((resolveCommand, reject) => {
      const child = spawn(
        browserBinary,
        ["--session", session, "--json", ...args],
        { windowsHide: true },
      );
      browserProcesses.add(child);
      let output = "",
        errors = "",
        settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolveCommand(value);
      };
      const timeout = setTimeout(() => {
        child.kill();
        finish(new Error(`Browser command timed out: ${args[0]} ${errors}`));
      }, 60_000);
      child.stderr.on("data", (chunk) => {
        errors += String(chunk);
      });
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
        for (const line of output.split(/\r?\n/)) {
          if (!line.startsWith("{")) continue;
          let result;
          try {
            result = JSON.parse(line);
          } catch {
            continue;
          }
          if (typeof result.success !== "boolean") continue;
          finish(
            result.success
              ? undefined
              : new Error(JSON.stringify(result.error)),
            result.data,
          );
          break;
        }
      });
      child.on("error", finish);
      child.on("close", (code) => {
        browserProcesses.delete(child);
        if (!settled)
          finish(new Error(`Browser exited ${code}: ${errors} ${output}`));
      });
    });
  }
  const evaluate = async (source: string) =>
    (await browser("eval", "-b", Buffer.from(source).toString("base64")))
      .result;
  const waitFor = (source: string) => browser("wait", "--fn", source);
  const field = (name: string) => `[name="${name}"]`;
  try {
    web = spawn(
      process.execPath,
      [
        resolve("../../node_modules/next/dist/bin/next"),
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(webPort),
      ],
      {
        cwd: process.cwd(),
        windowsHide: true,
        env: {
          ...process.env,
          NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${address.port}`,
          NEXT_PUBLIC_AUTH_DEV_TOKEN: "synthetic-builder-test",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    web.stdout?.on("data", (chunk) => {
      webLog += String(chunk);
    });
    web.stderr?.on("data", (chunk) => {
      webLog += String(chunk);
    });
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (web.exitCode !== null) throw new Error(`Next.js exited: ${webLog}`);
      try {
        if ((await fetch(`${webOrigin}/builder`)).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await delay(500);
    }
    assert(ready, `Next.js did not become ready: ${webLog}`);
    await browser("open", `${webOrigin}/builder`);
    await waitFor(
      'document.querySelector("input[name=name]")?.value === "Synthetic Candidate"',
    );
    await browser("snapshot", "-i");
    assert.equal(
      await evaluate('document.querySelector("button[type=submit]").disabled'),
      true,
    );

    await browser("fill", field("email"), "not-an-email");
    await browser("click", "button[type=submit]");
    assert.equal(writes, 0);
    assert.equal(
      await evaluate(
        'document.querySelector("input[name=email]").validity.typeMismatch',
      ),
      true,
    );
    await browser("fill", field("email"), "candidate@example.test");

    await browser("fill", field("name"), "Updated Candidate");
    saveStatus = 503;
    await browser("click", "button[type=submit]");
    await waitFor(
      'document.body.textContent.includes("Save could not be confirmed")',
    );
    assert.equal(
      await evaluate('document.querySelector("input[name=name]").value'),
      "Updated Candidate",
    );
    assert.equal(profile.version, 1);
    saveStatus = 200;
    historyFails = true;
    await browser("click", "button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 2.")');
    await waitFor(
      'document.body.textContent.includes("Version history could not be loaded")',
    );
    assert.equal(writes, 2);
    assert.deepEqual(profile.masterResume.awards, ["Synthetic award"]);
    assert.equal(profile.masterResume.experience[0]?.end, null);
    assert.equal(profile.masterResume.basics.name, "Updated Candidate");
    historyFails = false;

    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Review bullet",
      "--exact",
    );
    await waitFor(
      'document.body.textContent.includes("Apply suggested wording")',
    );
    assert.equal(
      await evaluate(
        'document.getElementsByName("experience.0.bullets")[0].value',
      ),
      "Built a parser",
    );
    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Apply suggested wording",
      "--exact",
    );
    assert.equal(
      await evaluate(
        'document.getElementsByName("experience.0.bullets")[0].value',
      ),
      "Built and maintained a parser",
    );
    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Review bullet",
      "--exact",
    );
    await browser("fill", field("experience.0.bullets"), "My newer wording");
    await waitFor('!document.body.textContent.includes("Reviewing bullet")');
    assert.equal(
      await evaluate(
        'document.body.textContent.includes("Apply suggested wording")',
      ),
      false,
    );
    coachStatus = 402;
    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Review bullet",
      "--exact",
    );
    await waitFor(
      'document.body.textContent.includes("coaching allowance is used up")',
    );
    assert.equal(
      await evaluate(
        'document.getElementsByName("experience.0.bullets")[0].value',
      ),
      "My newer wording",
    );
    assert.equal(coachingCalls, 3);
    await browser("click", "button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 3.")');
    assert.deepEqual(profile.masterResume.experience[0]?.bullets, [
      "My newer wording",
    ]);

    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Add role",
      "--exact",
    );
    await waitFor('document.activeElement?.name === "experience.1.company"');
    await browser("fill", field("experience.1.company"), "Second Example");
    await browser("fill", field("experience.1.title"), "Second role");
    // Exercise both decisions without a native modal blocking Windows CDP.
    await evaluate('window.__originalConfirm = window.confirm; window.confirm = () => false; true');
    await browser("find", "role", "button", "click", "--name", "Remove role 1", "--exact");
    assert.equal(await evaluate('document.getElementsByName("experience.0.company").length'), 1);
    await evaluate('window.confirm = () => true; true');
    await browser("find", "role", "button", "click", "--name", "Remove role 1", "--exact");
    await evaluate('window.confirm = window.__originalConfirm; delete window.__originalConfirm; true');
    await waitFor('!document.getElementsByName("experience.0.company").length');
    assert.equal(
      await evaluate(
        'document.getElementsByName("experience.1.company")[0].value',
      ),
      "Second Example",
    );
    await browser("click", "button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 4.")');
    assert.equal(profile.masterResume.experience.length, 1);
    assert.equal(profile.masterResume.experience[0]?.company, "Second Example");

    const captures = resolve(".next/builder-check");
    mkdirSync(captures, { recursive: true });
    await browser("set", "viewport", "1440", "1000");
    await evaluate("window.scrollTo(0, 0); true");
    await waitFor("window.scrollY === 0");
    await browser("screenshot", "--full", join(captures, "desktop.png"));
    await browser("set", "viewport", "390", "844");
    await evaluate("window.scrollTo(0, 0); true");
    await waitFor("window.scrollY === 0");
    assert.equal(
      await evaluate("document.documentElement.scrollWidth <= innerWidth"),
      true,
    );
    await browser("screenshot", "--full", join(captures, "mobile.png"));
    const accessibility = await browser(
      "a11y",
      "--selector",
      ".resume-builder",
    );
    assert.equal(
      accessibility.counts.violations,
      0,
      JSON.stringify(accessibility.violations),
    );
    console.log("Accessibility: zero automated violations in the builder.");
    await browser("reload");
    await waitFor(
      'document.querySelector("input[name=name]")?.value === "Updated Candidate"',
    );
    assert.equal(
      await evaluate(
        'document.getElementsByName("experience.0.company")[0].value',
      ),
      "Second Example",
    );
    profileStatus = 401;
    await browser("reload");
    await waitFor(
      'document.body.textContent.includes("Authentication is required")',
    );
    assert.equal(
      await evaluate('document.querySelector("form") === null'),
      true,
    );
    profileStatus = 200;
    await browser(
      "find",
      "role",
      "button",
      "click",
      "--name",
      "Retry loading resume",
      "--exact",
    );
    await waitFor(
      'document.querySelector("input[name=name]")?.value === "Updated Candidate"',
    );
    console.log(
      "PASS: load, native validation, save failure/retry, preservation, history failure, explicit coaching, stale coaching, quota, add/remove row identity, reload, authentication, mobile overflow, accessibility.",
    );
    console.log(`Screenshots: ${captures}`);
  } finally {
    await browser("close").catch(() => {});
    for (const child of browserProcesses) child.kill();
    if (web?.pid) {
      if (process.platform === "win32")
        spawn("taskkill", ["/pid", String(web.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else web.kill("SIGTERM");
    }
    apiServer.closeAllConnections();
    apiServer.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
