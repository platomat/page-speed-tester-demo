#!/usr/bin/env node
/**
 * Upload Lighthouse JSON reports to R2 and register metrics in D1 via Worker API.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { urlSlug } from "./url-slug.mjs";
import { slimLighthouseReport, reportMediaFlags } from "./slim-lighthouse-report.mjs";

const REPORTS_DIR = process.argv[2] ?? "reports";
const PROJECT_ID = process.env.PROJECT_ID;

function resolveRunAt(envRunAt, lighthouseJson, parsedRunAt) {
  const fromEnv = envRunAt?.trim();
  if (fromEnv) return fromEnv;
  if (lighthouseJson.fetchTime) return lighthouseJson.fetchTime;
  if (parsedRunAt) return parsedRunAt;
  return new Date().toISOString();
}

function extractMetrics(lighthouseJson) {
  const audits = lighthouseJson.audits ?? {};
  const categories = lighthouseJson.categories ?? {};

  const num = (id) => {
    const value = audits[id]?.numericValue;
    return value != null ? Number(value) : null;
  };

  return {
    performance:
      categories.performance?.score != null
        ? Math.round(categories.performance.score * 100)
        : null,
    lcp_ms: num("largest-contentful-paint"),
    cls: num("cumulative-layout-shift"),
    fcp_ms: num("first-contentful-paint"),
    tbt_ms: num("total-blocking-time"),
    speed_index: num("speed-index"),
  };
}

function parseReportFilename(filename) {
  const stamped = filename.match(
    /^(\d{4}-\d{2}-\d{2}T\d{6}Z)-(desktop|mobile)-(.+)\.json$/
  );
  if (stamped) {
    const ts = stamped[1];
    const runAt = `${ts.slice(0, 10)}T${ts.slice(11, 13)}:${ts.slice(13, 15)}:${ts.slice(15, 17)}.000Z`;
    return { runAt, identifier: stamped[3], strategy: stamped[2] };
  }
  return null;
}

async function loadUrlMap() {
  let projectUrls = { urls: [] };
  try {
    const raw = await readFile("project-urls.json", "utf8");
    projectUrls = JSON.parse(raw);
  } catch {
    console.warn("No project-urls.json found");
  }
  const byIdentifier = new Map();
  for (const u of projectUrls.urls ?? []) {
    byIdentifier.set(u.id, u);
    const slug = urlSlug(u.url);
    byIdentifier.set(slug, u);
    // Legacy slugs without scheme prefix (pre http/https distinction)
    const legacy = u.url
      .replace(/^https?:\/\//i, "")
      .replace(/\/+$/, "")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (legacy && legacy !== slug) byIdentifier.set(legacy, u);
  }
  return byIdentifier;
}

async function uploadToR2(client, bucket, key, body) {
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
    })
  );
}

async function registerRun(payload) {
  const response = await fetch(`${process.env.WORKER_API_URL}/api/runs`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WORKER_API_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker API error ${response.status}: ${text}`);
  }
}

async function main() {
  if (!PROJECT_ID) throw new Error("Missing env var: PROJECT_ID");

  const required = [
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_ENDPOINT",
    "WORKER_API_URL",
    "WORKER_API_SECRET",
  ];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`Missing env var: ${key}`);
  }

  const urlMap = await loadUrlMap();
  const s3 = new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  let files;
  try {
    files = await readdir(REPORTS_DIR);
  } catch {
    console.log(`No reports directory at ${REPORTS_DIR}`);
    return;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  for (const file of jsonFiles) {
    const parsed = parseReportFilename(file);
    if (!parsed) {
      console.warn(`Skipping unrecognized filename: ${file}`);
      continue;
    }

    const urlEntry = urlMap.get(parsed.identifier);
    if (!urlEntry) {
      console.warn(`No URL mapping for identifier ${parsed.identifier}, skipping ${file}`);
      continue;
    }

    const raw = await readFile(join(REPORTS_DIR, file), "utf8");
    const storeFullpageScreenshots =
      process.env.STORE_FULLPAGE_SCREENSHOTS === "1" ||
      process.env.STORE_FULLPAGE_SCREENSHOTS === "true";
    const storeTimingScreenshots =
      process.env.STORE_TIMING_SCREENSHOTS === "1" ||
      process.env.STORE_TIMING_SCREENSHOTS === "true";
    const lighthouseJson = slimLighthouseReport(JSON.parse(raw), {
      storeScreenshots: storeFullpageScreenshots,
      storeTimingScreenshots,
    });
    const media = reportMediaFlags(lighthouseJson);
    const metrics = extractMetrics(lighthouseJson);
    const body = JSON.stringify(lighthouseJson);
    const reportBytes = Buffer.byteLength(body, "utf8");

    const reportKey = `reports/${PROJECT_ID}/${file}`;
    await uploadToR2(s3, process.env.R2_BUCKET, reportKey, body);
    console.log(`Uploaded ${reportKey}`);

    const runAt = resolveRunAt(process.env.RUN_AT, lighthouseJson, parsed.runAt);
    const triggerSource = process.env.TRIGGER_SOURCE === "cron" ? "cron" : "manual";
    await registerRun({
      project_id: PROJECT_ID,
      url_id: urlEntry.id,
      strategy: parsed.strategy,
      run_at: runAt,
      report_key: reportKey,
      trigger_source: triggerSource,
      report_bytes: reportBytes,
      has_fullpage_screenshots: media.has_fullpage_screenshots,
      has_timing_screenshots: media.has_timing_screenshots,
      ...metrics,
    });
    console.log(`Registered run for ${urlEntry.url} (${parsed.strategy})`);
  }

  console.log("Upload complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
