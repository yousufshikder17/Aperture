import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
const values = {
  AUTH_MODE: "development", AUTH_DEV_FREE_TOKEN: "fixture-free-token-longer-than-thirty-two-characters",
  AUTH_DEV_PREMIUM_TOKEN: "fixture-premium-token-longer-than-thirty-two-characters",
  AUTH_DEV_ADMIN_TOKEN: "fixture-admin-token-longer-than-thirty-two-characters",
  NEXT_PUBLIC_AUTH_DEV_TOKEN: "fixture-premium-token-longer-than-thirty-two-characters",
  DATABASE_URL: "postgresql://fixture:fixture@127.0.0.1:1/root_fixture",
  NEXT_PUBLIC_API_BASE_URL: "http://localhost:9876", API_BASE_URL: "http://localhost:9876",
  FAST_PROVIDER: "gemini", QUALITY_PROVIDER: "claude", ANTHROPIC_API_KEY: "fixture-server-secret",
};
function fixture(t: TestContext) {
  // Keep fixtures beneath the repository so existing workspace dependencies resolve.
  const root = mkdtempSync(join(repo, ".root-env-test-"));
  for (const directory of ["scripts", "apps/api", "apps/web", "packages/db"])
    mkdirSync(join(root, directory), { recursive: true });
  for (const path of ["scripts/load-root-env.cjs", "apps/web/next.config.mjs", "packages/db/drizzle.config.ts"])
    copyFileSync(join(repo, path), join(root, path));
  writeFileSync(join(root, "package.json"), '{"type":"module"}');
  const content = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  writeFileSync(join(root, ".env"), content);
  t.after(() => {
    assert.equal(readFileSync(join(root, ".env"), "utf8"), content, "startup does not rewrite config or generate tokens");
    assert(root.startsWith(join(repo, ".root-env-test-")));
    rmSync(root, { recursive: true });
  });
  return root;
}
function run(cwd: string, args: string[], extra: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(values)) delete env[key];
  delete env.__NEXT_PROCESSED_ENV;
  delete env.NODE_OPTIONS;
  Object.assign(env, { NODE_ENV: "development", ...extra });
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim().split("\n").at(-1)!);
}

test("API development bootstrap loads root auth, database, provider and public values from its workspace without shell exports", t => {
  const root = fixture(t);
  const scripts = JSON.parse(readFileSync(join(repo, "apps/api/package.json"), "utf8")).scripts;
  const preload = /--require\s+(\S+)/.exec(scripts.dev)?.[1]; assert(preload);
  assert.equal(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts["dev:api"], "npm run dev -w @aperture/api");
  const result = run(join(root, "apps/api"), ["--require", preload, "-e",
    `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(values))}.map(key=>[key,process.env[key]]))))`]);
  assert.deepEqual(result, values);
});

test("Drizzle config resolves DATABASE_URL from root .env without copying it into the database workspace", t => {
  const root = fixture(t);
  assert.equal(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts["db:push"], "npm run push -w @aperture/db");
  const result = run(join(root, "packages/db"), ["--import", pathToFileURL(require.resolve("tsx")).href, "--input-type=module", "-e",
    "const {default:config}=await import('./drizzle.config.ts');console.log(JSON.stringify({url:config.dbCredentials.url,dialect:config.dialect}));"]);
  assert.deepEqual(result, { url: values.DATABASE_URL, dialect: "postgresql" });
});

test("Next config replaces a cached workspace environment with root values and never exposes server secrets through config.env", t => {
  const root = fixture(t);
  writeFileSync(join(root, "apps/web/.env.local"), "NEXT_PUBLIC_API_BASE_URL=http://incorrect-workspace.test");
  const staticEnv = pathToFileURL(require.resolve("next/dist/lib/static-env.js")).href;
  const result = run(join(root, "apps/web"), ["--input-type=module", "-e", `
    import nextEnv from '@next/env';
    nextEnv.loadEnvConfig(process.cwd(),true);
    const {default:config}=await import('./next.config.mjs');
    const {getNextPublicEnvironmentVariables}=await import(${JSON.stringify(staticEnv)});
    console.log(JSON.stringify({url:process.env.NEXT_PUBLIC_API_BASE_URL,token:process.env.NEXT_PUBLIC_AUTH_DEV_TOKEN,
      publicEnv:getNextPublicEnvironmentVariables(),configEnv:config.env??null}));`]);
  assert.equal(result.url, values.NEXT_PUBLIC_API_BASE_URL); assert.equal(result.token, values.AUTH_DEV_PREMIUM_TOKEN);
  assert.equal(result.configEnv, null);
  assert.equal(result.publicEnv["process.env.NEXT_PUBLIC_API_BASE_URL"], values.NEXT_PUBLIC_API_BASE_URL);
  assert(!JSON.stringify(result.publicEnv).includes(values.ANTHROPIC_API_KEY));
  assert(!Object.keys(result.publicEnv).some(key => /DATABASE_URL|AUTH_DEV_PREMIUM_TOKEN|ANTHROPIC_API_KEY/.test(key)));
});

test("root loader preserves explicit shell/deployment values and never loads local secrets in production", t => {
  const root = fixture(t), loader = resolve(root, "scripts/load-root-env.cjs");
  const override = run(root, ["--require", loader, "-e", "console.log(JSON.stringify({url:process.env.DATABASE_URL}));"],
    { DATABASE_URL: "postgresql://explicit-deployment" });
  assert.equal(override.url, "postgresql://explicit-deployment");
  const production = run(root, ["--require", loader, "-e", "console.log(JSON.stringify({url:process.env.DATABASE_URL,localAuth:process.env.AUTH_MODE??null,localPublic:process.env.NEXT_PUBLIC_AUTH_DEV_TOKEN??null}));"],
    { NODE_ENV: "production", DATABASE_URL: "postgresql://production" });
  assert.deepEqual(production, { url: "postgresql://production", localAuth: null, localPublic: null });
});
