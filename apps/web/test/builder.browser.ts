// Opt-in browser regression against synthetic API responses. No real database,
// identity provider, resume, or paid AI service is contacted.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomUUID } from "node:crypto";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { DEFAULT_TEMPLATE, MasterResumeSchema, ReferenceListSchema, TemplateSchema, type ReferenceList, type ResumeTemplate } from "@aperture/shared";
import { emptyResume } from "../src/app/builder/form-data.js";
import { renderResumePdf } from "../../api/src/lib/pdf-export.js";

async function main() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk = { ...await exportJWK(publicKey), alg: "RS256", kid: "browser-test", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string }>();
  let providerOrigin = "";
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
  let profile = { masterResume: emptyResume(), version: 1, referenceList: null as ReferenceList | null };
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
    saveStatus = 200;
  let writes = 0,
    coachingCalls = 0,
    historyFails = false;
  let uploadStatus = 200;
  let referenceStatus = 200;
  let marketStatus = 200;
  const uploadedTypes: string[] = [];
  let masterPdfStatus = 200;
  let masterPdfCalls = 0;
  let selectedTemplate: ResumeTemplate = DEFAULT_TEMPLATE;
  let templateSaves = 0;
  const listingId = "00000000-0000-4000-8000-000000000002";
  const listing = { id: listingId, source: "manual", url: "javascript:alert(1)", title: "Synthetic Backend Engineer",
    company: "Example Company", description: "Build reliable APIs. <script>bad()</script>", location: "Remote", salary: null, postedAt: null };
  const listingMatch = { overall: 0, subscores: { skills: 0, experience: 0, seniority: 0, location: 0 },
    strengths: [], concerns: ["Missing SQL"], verdict: "stretch", rationale: "Synthetic match" };
  let listingStatus = 200, matchStatus = 200, scanStatus = 403;
  let scanConfigured = false, hasMatch = false, matchCalls = 0;
  const listingRequests: string[] = [];
  const apiServer = createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? "/", providerOrigin || "http://127.0.0.1");
    const providerJson = (value: unknown, status = 200) =>
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value));
    if (requestUrl.pathname === "/.well-known/openid-configuration") {
      providerJson({ issuer: providerOrigin + "/", authorization_endpoint: providerOrigin + "/authorize",
        token_endpoint: providerOrigin + "/token", jwks_uri: providerOrigin + "/jwks" });
      return;
    }
    if (requestUrl.pathname === "/jwks") { providerJson({ keys: [publicJwk] }); return; }
    if (requestUrl.pathname === "/authorize") {
      if (requestUrl.searchParams.get("client_id") !== "synthetic-client" ||
        requestUrl.searchParams.get("redirect_uri") !== webOrigin + "/auth/callback" ||
        requestUrl.searchParams.get("code_challenge_method") !== "S256") { providerJson({}, 400); return; }
      const code = randomUUID();
      codes.set(code, { nonce: requestUrl.searchParams.get("nonce")!, challenge: requestUrl.searchParams.get("code_challenge")! });
      const callback = new URL(webOrigin + "/auth/callback");
      callback.searchParams.set("state", requestUrl.searchParams.get("state")!);
      callback.searchParams.set("code", code);
      res.writeHead(303, { location: callback.href }).end();
      return;
    }
    if (requestUrl.pathname === "/token") {
      let body = "";
      for await (const chunk of req) body += String(chunk);
      const params = new URLSearchParams(body);
      const code = params.get("code")!;
      const transaction = codes.get(code);
      codes.delete(code);
      if (!transaction || createHash("sha256").update(params.get("code_verifier") ?? "").digest("base64url") !== transaction.challenge) {
        providerJson({ error: "invalid_grant" }, 400); return;
      }
      const idToken = await new SignJWT({ nonce: transaction.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "browser-test" }).setIssuer(providerOrigin + "/")
        .setAudience("synthetic-client").setSubject("synthetic-user").setIssuedAt().setExpirationTime("10m").sign(privateKey);
      providerJson({ id_token: idToken, access_token: "synthetic-builder-test", token_type: "Bearer", expires_in: 600 });
      return;
    }
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
      if (requestUrl.pathname.startsWith("/v1/listings")) {
        listingRequests.push(requestUrl.pathname);
        const route = requestUrl.pathname.slice("/v1/listings".length);
        const row = { listing, match: hasMatch ? listingMatch : null, profileVersion: hasMatch ? profile.version : null };
        if (route === "" || route === "/") { send([row], listingStatus); return; }
        if (route === "/scan") { send({ configured: scanConfigured ? 1 : 0, succeeded: scanConfigured ? 1 : 0,
          scanned: scanConfigured ? 1 : 0, inserted: 0, failedSources: [] }, scanStatus); return; }
        if (route === "/" + listingId) { send(row, listingStatus); return; }
        if (route === "/" + listingId + "/match") {
          matchCalls++; await delay(400); if (matchStatus === 200) hasMatch = true;
          send({ score: listingMatch, profileVersion: profile.version }, matchStatus); return;
        }
        send({ error: "not_found" }, 404); return;
      }
      if (req.url === "/v1/builder/market-suggestions") {
        send([{ skill: "Rust", role_type: "Engineer", listings_requiring: 3, listings_total: 4, frequency_pct: 75 }], marketStatus);
        return;
      }
      if (req.url === "/v1/builder/upload") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const form = await new Request(webOrigin, { method: "POST",
          headers: { "content-type": req.headers["content-type"]! }, body: Buffer.concat(chunks) }).formData();
        uploadedTypes.push((form.get("file") as File).type);
        const resume = emptyResume();
        resume.basics.name = "Imported Candidate";
        resume.basics.email = "imported@example.test";
        send({ resume, layoutFindings: [{ issue: "Two columns", atsRisk: "high", fix: "Use one column" }] }, uploadStatus);
        return;
      }
      if (req.url?.startsWith("/v1/templates/library")) {
        const q = new URL(req.url, webOrigin).searchParams.get("q")?.toLowerCase() ?? "";
        const catalog = [DEFAULT_TEMPLATE, TemplateSchema.parse({ ...DEFAULT_TEMPLATE,
          id: "technical-sidebar", name: "Technical sidebar", tags: ["technical", "two column"],
          layout: { ...DEFAULT_TEMPLATE.layout, columns: 2, sidebar: ["skills"] },
          atsCompatibility: { score: 75, warnings: ["Two columns can change reading order in some ATS parsers."] },
        })];
        send(catalog.filter((item) => !q || [item.name, ...item.tags].some((text) => text.toLowerCase().includes(q))));
        return;
      }
      if (req.url === "/v1/templates/active" && req.method === "GET") {
        send({ template: selectedTemplate, saved: templateSaves > 0 }); return;
      }
      if (req.url === "/v1/auth/me") {
        send({ id: "synthetic-user", email: "candidate@example.test" });
        return;
      }
      if (req.url === "/v1/profile" && req.method === "GET") {
        send(profile, profileStatus);
        return;
      }
      if (req.url === "/v1/profile/pdf") {
        masterPdfCalls++;
        if (masterPdfStatus !== 200) { send({ error: "download_failed" }, masterPdfStatus); return; }
        res.writeHead(200, { "content-type": "application/pdf", "content-disposition": "attachment; filename=resume-master.pdf" }).end("%PDF-synthetic");
        return;
      }
      if (req.url === "/v1/builder/versions") {
        send(
          profile.version ? [{ version: profile.version, createdAt: "2026-09-18T12:00:00.000Z", profileStrength: 73, avgMatchScore: 0, avgAtsScore: null }] : [],
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
          ...profile,
          masterResume: MasterResumeSchema.parse(JSON.parse(body)),
          version: profile.version + 1,
        };
        send(profile);
        return;
      }
      if (req.url === "/v1/builder/improve-bullet") {
        coachingCalls++;
        send({ error: "not_found" }, 404);
        return;
      }
      if (req.url === "/v1/profile/references" && req.method === "PUT") {
        if (referenceStatus !== 200) { send({ error: "failed" }, referenceStatus); return; }
        profile.referenceList = ReferenceListSchema.parse(JSON.parse(body));
        send(profile);
        return;
      }
      if (req.url === "/v1/templates/preview" && req.method === "POST") {
        const pdf = await renderResumePdf(profile.masterResume, TemplateSchema.parse(JSON.parse(body)));
        res.writeHead(200, { "content-type": "application/pdf" }).end(Buffer.from(pdf));
        return;
      }
      if (req.url === "/v1/templates/active" && req.method === "PUT") {
        selectedTemplate = TemplateSchema.parse(JSON.parse(body)); templateSaves++;
        send(selectedTemplate); return;
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
  const waitFor = async (source: string) => {
    try { return await browser("wait", "--fn", source); }
    catch (cause) { throw new Error("Browser condition failed: " + source, { cause }); }
  };
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
          AUTH_DEV_WEB_TOKEN: "synthetic-builder-test",
          API_BASE_URL: `http://127.0.0.1:${address.port}`,
          WEB_APP_URL: webOrigin,
          WEB_OIDC_ISSUER: `http://127.0.0.1:${address.port}/`,
          WEB_OIDC_CLIENT_ID: "synthetic-client",
          WEB_SESSION_SECRET: "ab".repeat(32),
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
    const startupDeadline = Date.now() + 60_000;
    while (Date.now() < startupDeadline) {
      if (web.exitCode !== null) throw new Error(`Next.js exited: ${webLog}`);
      try {
        if ((await fetch(`${webOrigin}/builder`, { signal: AbortSignal.timeout(5000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* startup */
      }
      await delay(500);
    }
    assert(ready, `Next.js did not become ready: ${webLog}`);
    providerOrigin = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(webOrigin + "/api/backend/profile", {
      headers: { cookie: "aperture-session=invalid", authorization: "Bearer synthetic-builder-test" },
    })).status, 401, "a caller token cannot replace a valid browser session");
    assert.equal((await fetch(webOrigin + "/api/backend/profile", {
      method: "PUT", headers: { origin: "https://attacker.test" }, body: "{}",
    })).status, 403);
    assert.equal((await fetch(webOrigin + "/auth/logout")).status, 405);
    assert.equal((await fetch(webOrigin + "/auth/logout", { method: "POST",
      headers: { origin: "https://attacker.test" } })).status, 403);
    const logout = await fetch(webOrigin + "/auth/logout", { method: "POST",
      headers: { origin: webOrigin }, redirect: "manual" });
    assert.equal(logout.status, 303);
    assert.ok(logout.headers.get("set-cookie")?.includes("Max-Age=0"));
    const callback = await fetch(webOrigin + "/auth/callback?state=wrong&code=wrong", { redirect: "manual" });
    assert.equal(callback.status, 303);
    assert.ok(callback.headers.get("location")?.endsWith("/account?error=signin"));
    await browser("open", `${webOrigin}/auth/login`);
    await waitFor(
      'document.querySelector("input[name=name]")?.value === "Synthetic Candidate"',
    );
    assert.equal(await evaluate('document.cookie.includes("aperture-session")'), false);
    await browser("snapshot", "-i");
    assert.equal(
      await evaluate('document.querySelector(".builder-form button[type=submit]").disabled'),
      true,
    );

    await browser("fill", field("email"), "not-an-email");
    await browser("click", ".builder-form button[type=submit]");
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
    await browser("click", ".builder-form button[type=submit]");
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
    await browser("click", ".builder-form button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 2.")');
    await waitFor(
      'document.body.textContent.includes("Version history could not be loaded")',
    );
    assert.equal(writes, 2);
    assert.deepEqual(profile.masterResume.awards, ["Synthetic award"]);
    assert.equal(profile.masterResume.experience[0]?.end, null);
    assert.equal(profile.masterResume.basics.name, "Updated Candidate");
    historyFails = false;

    assert.equal(await evaluate('document.body.textContent.includes("Review bullet")'), false);
    assert.equal(await evaluate('document.getElementsByName("experience.0.bullets")[0].value'), "Built a parser");
    await browser("fill", field("experience.0.bullets"), "My newer wording");
    assert.equal(coachingCalls, 0);
    await browser("click", ".builder-form button[type=submit]");
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
    await browser("click", ".builder-form button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 4.")');
    assert.equal(profile.masterResume.experience.length, 1);
    assert.equal(profile.masterResume.experience[0]?.company, "Second Example");

    // Keep browser outputs outside Next's cleanable build directory (Windows locks).
    const captures = resolve("../../exports/browser-check");
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
      "PASS: load, native validation, save failure/retry, preservation, history failure, manual bullets without hosted coaching, add/remove row identity, reload, authentication, mobile overflow, accessibility.",
    );
    const selectImport = async (name: string) => {
      // Exercise the native file input, not a script-assigned synthetic FileList.
      const file = join(captures, name);
      writeFileSync(file, "synthetic document");
      await browser("upload", "input[type=file]", file);
    };
    await selectImport("resume.exe");
    await browser("find", "role", "button", "click", "--name", "Extract for review", "--exact");
    await waitFor('document.body.textContent.includes("Choose a PDF or DOCX file.")');
    assert.equal(uploadedTypes.length, 0);
    await selectImport("resume.pdf");
    uploadStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Extract for review", "--exact");
    await waitFor('document.body.textContent.includes("Extraction failed")');
    assert.equal(await evaluate('document.querySelector("input[name=name]").value'), "Updated Candidate");
    uploadStatus = 200;
    const beforeImport = writes;
    await browser("find", "role", "button", "click", "--name", "Extract for review", "--exact");
    await waitFor('document.body.textContent.includes("Review extracted draft")');
    assert.equal(writes, beforeImport);
    assert.equal(profile.masterResume.basics.name, "Updated Candidate");
    await browser("find", "role", "button", "click", "--name", "Discard import", "--exact");
    await selectImport("resume.docx");
    await browser("find", "role", "button", "click", "--name", "Extract for review", "--exact");
    await waitFor('document.body.textContent.includes("Review extracted draft")');
    await evaluate("window.importConfirm = window.confirm; window.confirm = () => false");
    await browser("find", "role", "button", "click", "--name", "Use extracted draft", "--exact");
    assert.equal(await evaluate('document.querySelector("input[name=name]").value'), "Updated Candidate");
    await evaluate("window.confirm = () => true");
    await browser("find", "role", "button", "click", "--name", "Use extracted draft", "--exact");
    await evaluate("window.confirm = window.importConfirm");
    await waitFor('document.querySelector("input[name=name]")?.value === "Imported Candidate"');
    assert.equal(writes, beforeImport);
    assert.equal(profile.masterResume.basics.name, "Updated Candidate");
    assert.equal(await evaluate('document.querySelector(".builder-form button[type=submit]").disabled'), false);
    await browser("fill", field("name"), "Reviewed Candidate");
    saveStatus = 503;
    await browser("click", ".builder-form button[type=submit]");
    await waitFor('document.body.textContent.includes("Save could not be confirmed")');
    assert.equal(await evaluate('document.querySelector("input[name=name]").value'), "Reviewed Candidate");
    saveStatus = 200;
    await browser("click", ".builder-form button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 5")');
    assert.equal(profile.masterResume.basics.name, "Reviewed Candidate");
    assert.ok(uploadedTypes.includes("application/pdf"));
    assert.ok(uploadedTypes.includes("application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
    console.log("PASS: PDF/DOCX import, invalid file, extraction failure, discard, replacement confirmation, review/edit, explicit save and retry.");
    const resumeBeforeReferences = JSON.stringify(profile.masterResume);
    assert.equal(await evaluate('document.querySelector("#audit-heading") !== null'), false);
    assert.ok(await evaluate('document.body.textContent.includes("Match: 0.0 / 100")'));
    assert.ok(await evaluate('document.body.textContent.includes("ATS: Pending / unavailable")'));
    marketStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Load market suggestions", "--exact");
    await waitFor('document.body.textContent.includes("Market suggestions are unavailable")');
    marketStatus = 200;
    await browser("find", "role", "button", "click", "--name", "Load market suggestions", "--exact");
    await waitFor('document.body.textContent.includes("75.0%")');
    await browser("find", "role", "button", "click", "--name", "Add reference", "--exact");
    await browser("fill", field("references.0.name"), "Synthetic Manager");
    await browser("fill", field("references.0.relationship"), "Direct manager");
    await browser("fill", field("references.0.contact"), "manager@example.test");
    referenceStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Save references", "--exact");
    await waitFor('document.body.textContent.includes("Reference save could not be confirmed")');
    assert.equal(profile.referenceList, null);
    assert.equal(await evaluate('document.getElementsByName("references.0.name")[0].value'), "Synthetic Manager");
    referenceStatus = 200;
    await browser("find", "role", "button", "click", "--name", "Save references", "--exact");
    await waitFor('document.body.textContent.includes("References saved.")');
    assert.equal(ReferenceListSchema.parse(profile.referenceList).references[0]?.name, "Synthetic Manager");
    assert.equal(JSON.stringify(profile.masterResume), resumeBeforeReferences);
    await browser("reload");
    await waitFor('document.getElementsByName("references.0.name")[0]?.value === "Synthetic Manager"');
    await browser("fill", field("references.0.title"), "Updated title");
    await browser("find", "role", "button", "click", "--name", "Save references", "--exact");
    await waitFor('document.body.textContent.includes("References saved.")');
    await delay(500);
    await browser("find", "role", "button", "click", "--name", "Load market suggestions", "--exact");
    await waitFor('document.body.textContent.includes("75.0%")');
    await browser("set", "viewport", "1440", "1000");
    await evaluate("window.scrollTo(0, 0)");
    await browser("screenshot", join(captures, "desktop.png"), "--full");
    await browser("set", "viewport", "390", "844");
    await evaluate("window.scrollTo(0, 0)");
    await browser("screenshot", join(captures, "mobile.png"), "--full");
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
    console.log("PASS: saved-version display, market retry and zero/pending scores.");
    console.log("PASS: independent reference save, failure/retry, persistence and resume preservation.");
    await browser("open", webOrigin + "/account");
    await waitFor('document.body.textContent.includes("Signed in as candidate@example.test")');
    await evaluate("window.scrollTo(0, 0)");
    await browser("screenshot", join(captures, "account-mobile.png"), "--full");
    await browser("set", "viewport", "1440", "1000");
    await browser("screenshot", join(captures, "account-desktop.png"), "--full");
    await browser("find", "role", "link", "click", "--name", "Builder", "--exact");
    await waitFor('document.querySelector("input[name=name]")?.value === "Reviewed Candidate"');
    await browser("fill", field("name"), "Unsaved history test");
    await browser("fill", field("references.0.title"), "Another reference title");
    await browser("find", "role", "button", "click", "--name", "Save references", "--exact");
    await waitFor('document.body.textContent.includes("References saved.")');
    assert.equal(await evaluate('window.dispatchEvent(new Event("beforeunload", { cancelable: true }))'), false,
      "saving one dirty form must not remove another form's leave warning");
    await evaluate('sessionStorage.removeItem("test-beforeunload"); window.addEventListener("beforeunload", event => sessionStorage.setItem("test-beforeunload", event.defaultPrevented ? "yes" : "no"))');
    // Schedule navigation so the daemon can handle the native dialog separately.
    await evaluate('setTimeout(() => history.back(), 200); true');
    await delay(400);
    await browser("dialog", "dismiss");
    assert.equal(await evaluate('location.pathname'), "/builder");
    assert.equal(await evaluate('document.querySelector("input[name=name]").value'), "Unsaved history test");
    await evaluate('setTimeout(() => history.back(), 200); true');
    await delay(400);
    await browser("dialog", "accept");
    await waitFor('location.pathname === "/account"');
    assert.equal(await evaluate('sessionStorage.getItem("test-beforeunload")'), "yes");
    console.log("PASS: independent dirty-form guards, browser Back cancel preserves draft, and confirmed Back leaves.");
    const listingWritesBefore = writes;
    await browser("open", webOrigin + "/listings");
    await waitFor('document.body.textContent.includes("Synthetic Backend Engineer")');
    await browser("find", "role", "button", "click", "--name", "Scan configured feeds (admin)", "--exact");
    await waitFor('document.querySelector("[role=alert]")?.textContent.includes("requires an administrator")');
    scanStatus = 200;
    await browser("find", "role", "button", "click", "--name", "Scan configured feeds (admin)", "--exact");
    await waitFor('document.body.textContent.includes("No feeds are configured")');
    scanConfigured = true;
    await browser("find", "role", "button", "click", "--name", "Scan configured feeds (admin)", "--exact");
    await waitFor('document.body.textContent.includes("0 new listings added from 1")');
    listingStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Refresh listings", "--exact");
    await waitFor('document.querySelector("[role=alert]") !== null');
    assert.equal(await evaluate('document.body.textContent.includes("Synthetic Backend Engineer")'), true);
    listingStatus = 200;
    await browser("find", "role", "button", "click", "--name", "Refresh listings", "--exact");
    await waitFor('document.querySelector("[role=alert]") === null');
    await browser("find", "role", "link", "click", "--name", "Synthetic Backend Engineer", "--exact");
    await waitFor('document.body.textContent.includes("No saved match yet")');
    assert.equal(await evaluate('document.querySelector("a[href^=javascript]")'), null);
    for (const [failure, message] of [[402, "allowance is exhausted"], [409, "Save a master resume"], [401, "Sign in through Account"]] as const) {
      matchStatus = failure;
      await browser("find", "role", "button", "click", "--name", "Score match", "--exact");
      await waitFor(`document.body.textContent.includes(${JSON.stringify(message)})`);
    }
    matchStatus = 200;
    const previousCalls = matchCalls;
    await browser("find", "role", "button", "click", "--name", "Score match", "--exact");
    await evaluate('document.querySelector(".listing-primary").click()');
    await waitFor('document.body.textContent.includes("Transparent match: 0.0 / 100")');
    assert.equal(matchCalls, previousCalls + 1);
    matchStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Score match", "--exact");
    await waitFor('document.querySelector("[role=alert]") !== null');
    assert.equal(await evaluate('document.body.textContent.includes("Transparent match: 0.0 / 100")'), true);
    await browser("reload");
    await waitFor('document.body.textContent.includes("Transparent match: 0.0 / 100")');
    assert.equal(writes, listingWritesBefore);
    assert.equal(listingRequests.some(path => /\/intel|\/tailor/.test(path)), false, "public UI must never call private endpoints");
    assert.equal(await evaluate('document.body.textContent.includes("Generate tailored resume")'), false);
    await browser("set", "viewport", "1440", "1000");
    await evaluate("window.scrollTo(0, 0)");
    await browser("screenshot", join(captures, "listing-desktop.png"), "--full");
    await browser("set", "viewport", "390", "844");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    await browser("screenshot", join(captures, "listing-mobile.png"), "--full");
    const detailA11y = await browser("a11y");
    assert.equal(detailA11y.violations.length, 0, JSON.stringify(detailA11y.violations));
    await browser("open", webOrigin + "/listings");
    await waitFor('document.body.textContent.includes("Match: 0.0 / 100")');
    await browser("screenshot", join(captures, "listings-mobile.png"), "--full");
    await browser("set", "viewport", "1440", "1000");
    await browser("screenshot", join(captures, "listings-desktop.png"), "--full");
    const listA11y = await browser("a11y");
    assert.equal(listA11y.violations.length, 0, JSON.stringify(listA11y.violations));
    console.log("PASS: public listing scan/admin/configuration states, match quota/profile/session recovery, double-click protection, saved match reload, no private calls, mobile and accessibility.");
    profile = { masterResume: emptyResume(), version: 0, referenceList: null };
    await browser("open", webOrigin + "/builder");
    await waitFor('document.body.textContent.includes("Your first master resume")');
    const beforeCreate = writes;
    await browser("find", "role", "button", "click", "--name", "Review current draft", "--exact");
    assert.equal(await evaluate('document.querySelector(".builder-review") === null'), true);
    assert.equal(await evaluate('document.activeElement.name'), "name");
    await browser("fill", field("name"), "New Candidate");
    await browser("fill", field("email"), "new@example.test");
    await browser("fill", field("summary"), "I build reliable tools.");
    await browser("fill", field("targetRoles"), "Developer");
    await browser("find", "role", "link", "click", "--name", "Projects", "--exact");
    assert.equal(await evaluate('location.hash'), "#builder-projects");
    await browser("find", "role", "button", "click", "--name", "Add project", "--exact");
    await browser("fill", field("projects.0.name"), "Parser");
    await browser("fill", field("projects.0.description"), "A small text parser");
    await browser("find", "role", "button", "click", "--name", "Add bullet", "--exact");
    await browser("fill", field("projects.0.bullets"), "Parsed structured inputs");
    assert.equal(await evaluate('document.body.textContent.includes("Review bullet")'), false);
    await browser("find", "role", "button", "click", "--name", "Add qualification", "--exact");
    await browser("fill", field("education.0.institution"), "College");
    await browser("fill", field("education.0.credential"), "BSc");
    await browser("find", "role", "button", "click", "--name", "Add skill", "--exact");
    await browser("fill", field("skills.0.name"), "TypeScript");
    await browser("find", "role", "button", "click", "--name", "Review current draft", "--exact");
    await waitFor('document.querySelector(".builder-review")?.textContent.includes("Parsed structured inputs")');
    assert.equal(await evaluate('document.activeElement.id'), "review-heading");
    assert.equal(writes, beforeCreate);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Download saved resume PDF").disabled'), true);
    await browser("fill", field("name"), "Reviewed New Candidate");
    assert.equal(await evaluate('document.querySelector(".builder-review") === null'), true);
    await browser("click", ".builder-form button[type=submit]");
    await waitFor('document.body.textContent.includes("Saved as version 1.")');
    assert.equal(profile.masterResume.projects[0]?.name, "Parser");
    assert.equal(profile.masterResume.education[0]?.credential, "BSc");
    assert.equal(profile.masterResume.skills[0]?.name, "TypeScript");
    masterPdfStatus = 503;
    await browser("find", "role", "button", "click", "--name", "Download saved resume PDF", "--exact");
    await waitFor('document.body.textContent.includes("PDF download failed")');
    masterPdfStatus = 200;
    await browser("find", "role", "button", "click", "--name", "Download saved resume PDF", "--exact");
    await waitFor('document.body.textContent.includes("Saved resume PDF download started")');
    assert.equal(masterPdfCalls, 2);
    assert.equal(coachingCalls, 0);
    assert.equal(writes, beforeCreate + 1);
    await browser("reload");
    await waitFor('document.querySelector("input[name=name]")?.value === "Reviewed New Candidate"');
    await browser("find", "role", "button", "click", "--name", "Review current draft", "--exact");
    for (const [name, width, height] of [["guided-desktop", "1440", "1000"], ["guided-mobile", "390", "844"]]) {
      await browser("set", "viewport", width!, height!);
      await evaluate("window.scrollTo(0, 0)");
      await browser("screenshot", join(captures, name + ".png"));
      await browser("screenshot", join(captures, name + "-full.png"), "--full");
      await evaluate('document.querySelector("#builder-review").scrollIntoView()');
      await browser("screenshot", join(captures, name + "-review.png"));
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    const builderA11y = await browser("a11y", "--selector", ".resume-builder");
    assert.equal(builderA11y.counts.violations, 0, JSON.stringify(builderA11y.violations));
    console.log("PASS: public creation, section guidance, draft review, PDF recovery, no hosted coaching, reload, desktop/mobile and accessibility.");
    await browser("open", webOrigin + "/templates");
    await waitFor('document.body.textContent.includes("Technical sidebar")');
    assert.equal(await evaluate('document.body.textContent.includes("Bring your own template")'), false);
    await browser("fill", "#template-query", "technical");
    await browser("find", "role", "button", "click", "--name", "Search", "--exact");
    await waitFor('document.querySelectorAll(".template-option").length === 1');
    await browser("find", "role", "button", "click", "--name", "Review this design", "--exact");
    await waitFor('document.querySelector("#template-editor") !== null');
    assert.equal(await evaluate('document.body.textContent.includes("ATS compatibility 75/100")'), true);
    assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Save this design").disabled'), true);
    await browser("find", "role", "button", "click", "--name", "Preview with my resume", "--exact");
    await waitFor('document.querySelector(".template-preview iframe") !== null');
    await browser("find", "role", "button", "click", "--name", "Save this design", "--exact");
    await waitFor('document.body.textContent.includes("Template saved")');
    assert.equal(await evaluate('document.body.textContent.includes("tailored PDF")'), false);
    assert.equal(selectedTemplate.id, "technical-sidebar");
    assert.equal(templateSaves, 1);
    for (const [name, width, height] of [["desktop", "1440", "1000"], ["mobile", "390", "844"]]) {
      await browser("set", "viewport", width!, height!);
      await browser("screenshot", join(captures, `templates-${name}.png`), "--full");
      assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    }
    const templateA11y = await browser("a11y", "--selector", ".template-page");
    assert.equal(templateA11y.counts.violations, 0, JSON.stringify(templateA11y.violations));
    console.log("PASS: public template search, warning, preview-before-save, persistence, mobile and accessibility.");
    await browser("open", webOrigin + "/account");
    await waitFor('document.body.textContent.includes("Signed in as candidate@example.test")');
    await browser("find", "role", "button", "click", "--name", "Sign out of Aperture", "--exact");
    await waitFor('document.body.textContent.includes("You are not signed in to Aperture.")');
    assert.equal(await evaluate('(async () => (await fetch("/api/backend/profile")).status)()'), 401);
    console.log("PASS: real OIDC browser redirects, PKCE callback, HttpOnly cookie and logout without development fallback.");
    console.log("PASS: server-rendered account identity, forged credentials, CSRF, callback failure, logout.");
    console.log(`Screenshots: ${captures}`);
  } catch (error) {
    console.error(webLog);
    throw error;
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
