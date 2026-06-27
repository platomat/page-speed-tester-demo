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

/** Detect screenshot content remaining in stored Lighthouse JSON. */
export function reportMediaFlags(lighthouseJson) {
  const audits = lighthouseJson.audits ?? {};
  const hasFullpageScreenshots =
    Boolean(lighthouseJson.fullPageScreenshot) ||
    Boolean(audits["final-screenshot"]?.details?.data) ||
    Boolean(audits["full-page-screenshot"]?.details?.data);
  const timingItems = audits["screenshot-thumbnails"]?.details?.items;
  const hasTimingScreenshots =
    Array.isArray(timingItems) && timingItems.some((item) => Boolean(item?.data));
  return {
    has_fullpage_screenshots: hasFullpageScreenshots,
    has_timing_screenshots: hasTimingScreenshots,
  };
}
