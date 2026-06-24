/**
 * Remove bulky screenshot data from Lighthouse JSON before storage (default).
 * Skipped when storeScreenshots is true.
 */
export function slimLighthouseReport(lighthouseJson, options = {}) {
  if (options.storeScreenshots) return lighthouseJson;
  const out = structuredClone(lighthouseJson);
  delete out.fullPageScreenshot;
  if (out.audits) {
    delete out.audits["full-page-screenshot"];
    delete out.audits["final-screenshot"];
  }
  return out;
}
