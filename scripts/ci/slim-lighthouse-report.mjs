/**
 * Remove bulky full-page screenshot data from Lighthouse JSON before storage.
 * Viewport capture remains in audits["final-screenshot"].
 */
export function slimLighthouseReport(lighthouseJson) {
  const out = structuredClone(lighthouseJson);
  delete out.fullPageScreenshot;
  if (out.audits) {
    delete out.audits["full-page-screenshot"];
  }
  return out;
}
