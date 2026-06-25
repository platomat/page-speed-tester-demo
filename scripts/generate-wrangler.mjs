#!/usr/bin/env node
/**
 * Generates wrangler.toml from wrangler.toml.template + environment variables.
 * Used locally (reads .env) and on Cloudflare Workers Git deploy (Build env vars).
 *
 * Required: D1_DATABASE_ID, KV_NAMESPACE_ID
 * Optional: WORKER_NAME (default page-speed-tester-api), CRON_EXPRESSION (default every 5 min)
 * Optional: PST_INSTANCE_ROLE (explicit); auto-set to "upstream" when building from repo page-speed-tester-demo
 */

import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const UPSTREAM_SOURCE_REPO = "page-speed-tester-demo";

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
  return out.trimEnd() + "\n";
}

function repoNameFromGitRemote(url) {
  const normalized = url.trim().replace(/\.git$/, "");
  const segments = normalized.split("/").filter(Boolean);
  return segments.at(-1)?.toLowerCase() ?? "";
}

function detectBuildRepositoryName() {
  const gh = process.env.GITHUB_REPOSITORY?.trim();
  if (gh) return gh.split("/").pop()?.toLowerCase() ?? "";

  const cfPages = process.env.CF_PAGES_REPO_NAME?.trim();
  if (cfPages) return cfPages.toLowerCase();

  try {
    return repoNameFromGitRemote(execSync("git remote get-url origin", { encoding: "utf8" }));
  } catch {
    return "";
  }
}

function resolveInstanceRole() {
  const explicit = process.env.PST_INSTANCE_ROLE?.trim().toLowerCase();
  if (explicit) return explicit;

  const repoName = detectBuildRepositoryName();
  if (repoName === UPSTREAM_SOURCE_REPO) return "upstream";

  return "";
}

function workerVarsSection(role) {
  if (role !== "upstream") return "";
  return `[vars]\nPST_INSTANCE_ROLE = "upstream"\n`;
}

await loadDotEnv();

const instanceRole = resolveInstanceRole();

const vars = {
  WORKER_NAME: process.env.WORKER_NAME?.trim() || "page-speed-tester-api",
  D1_DATABASE_ID: requireEnv("D1_DATABASE_ID"),
  KV_NAMESPACE_ID: requireEnv("KV_NAMESPACE_ID"),
  CRON_EXPRESSION: process.env.CRON_EXPRESSION?.trim() || "*/5 * * * *",
  WORKER_VARS_SECTION: workerVarsSection(instanceRole),
};

const template = await readFile(templatePath, "utf8");
const toml = substitute(template, vars);
await writeFile(outputPath, toml, "utf8");

const roleNote = instanceRole ? `, PST_INSTANCE_ROLE=${instanceRole}` : "";
console.log(`generate-wrangler: wrote ${outputPath} (name=${vars.WORKER_NAME}${roleNote})`);
