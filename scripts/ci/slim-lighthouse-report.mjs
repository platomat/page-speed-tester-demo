/**
 * Remove bulky screenshot data from Lighthouse JSON before storage.
 * storeScreenshots: viewport + full-page (final-screenshot, full-page-screenshot).
 * storeTimingScreenshots: filmstrip frames (screenshot-thumbnails audit).
 */
export function slimLighthouseReport(lighthouseJson, options = {}) {
  const out = structuredClone(lighthouseJson);
  if (!options.storeScreenshots) {
    delete out.fullPageScreenshot;
    if (out.audits) {
      delete out.audits["full-page-screenshot"];
      delete out.audits["final-screenshot"];
    }
  }
  if (!options.storeTimingScreenshots) {
    if (out.audits) {
      delete out.audits["screenshot-thumbnails"];
    }
  }
  return out;
}
