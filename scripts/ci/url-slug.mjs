#!/usr/bin/env node
/**
 * Stable slug for Lighthouse report filenames from a page URL.
 * Usage: node scripts/ci/url-slug.mjs "https://www.mydomain.tld/"
 */

function transliterateGerman(value) {
  return String(value)
    .replace(/[Ää]/g, "ae")
    .replace(/[Öö]/g, "oe")
    .replace(/[Üü]/g, "ue")
    .replace(/[ßẞ]/g, "ss");
}

export function urlSlug(url) {
  const scheme = url.match(/^(https?):\/\//i)?.[1]?.toLowerCase() ?? "http";
  const hostPath = transliterateGerman(url)
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return hostPath ? `${scheme}-${hostPath}` : scheme;
}

if (process.argv[1]?.endsWith("url-slug.mjs")) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: node scripts/ci/url-slug.mjs <url>");
    process.exit(1);
  }
  console.log(urlSlug(url));
}
