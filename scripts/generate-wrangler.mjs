#!/usr/bin/env node
/**
 * Generates wrangler.toml from wrangler.toml.template + environment variables.
 * Used locally (reads .env) and on Cloudflare Workers Git deploy (Build env vars).
 *
 * Required: D1_DATABASE_ID, KV_NAMESPACE_ID
 * Optional: WORKER_NAME (default page-speed-tester), CRON_EXPRESSION (default every 5 min)
 */

import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const templatePath = join(root, "wrangler.toml.template");
const outputPath = join(root, "wrangler.toml");

async function loadDotEnv() {
  try {
    const text = await readFile(join(root, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key]) continue;
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // no local .env
  }
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`generate-wrangler: missing required env ${name}`);
    console.error("Set it in Cloudflare Workers → Settings → Variables (Build) or in local .env");
    process.exit(1);
  }
  return value;
}

function substitute(template, vars) {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  if (/\{\{[A-Z_]+\}\}/.test(out)) {
    console.error("generate-wrangler: unresolved placeholders in template");
    process.exit(1);
  }
  return out;
}

await loadDotEnv();

const vars = {
  WORKER_NAME: process.env.WORKER_NAME?.trim() || "page-speed-tester",
  D1_DATABASE_ID: requireEnv("D1_DATABASE_ID"),
  KV_NAMESPACE_ID: requireEnv("KV_NAMESPACE_ID"),
  CRON_EXPRESSION: process.env.CRON_EXPRESSION?.trim() || "*/5 * * * *",
};

const template = await readFile(templatePath, "utf8");
const toml = substitute(template, vars);
await writeFile(outputPath, toml, "utf8");

console.log(`generate-wrangler: wrote ${outputPath} (name=${vars.WORKER_NAME})`);
