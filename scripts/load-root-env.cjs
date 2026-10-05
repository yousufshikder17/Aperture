const { resolve } = require("node:path");
const { loadEnvConfig } = require("@next/env");

// Development only; deployed processes retain their supplied environment.
if (process.env.NODE_ENV !== "production") {
  // Next may already have cached the web workspace's environment before reading its config.
  loadEnvConfig(resolve(__dirname, ".."), true, undefined, true);
}
