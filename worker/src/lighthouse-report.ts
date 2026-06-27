/** Strip screenshot data from Lighthouse JSON when store flags are off. */
export function slimLighthouseReport(
  lighthouse: Record<string, unknown>,
  options?: { storeScreenshots?: boolean; storeTimingScreenshots?: boolean }
): Record<string, unknown> {
  const out = { ...lighthouse };
  if (!options?.storeScreenshots) {
    delete out.fullPageScreenshot;
    const audits = out.audits;
    if (audits && typeof audits === "object") {
      const trimmed = { ...(audits as Record<string, unknown>) };
      delete trimmed["full-page-screenshot"];
      delete trimmed["final-screenshot"];
      out.audits = trimmed;
    }
  }
  if (!options?.storeTimingScreenshots) {
    const audits = out.audits;
    if (audits && typeof audits === "object") {
      const trimmed = { ...(audits as Record<string, unknown>) };
      delete trimmed["screenshot-thumbnails"];
      out.audits = trimmed;
    }
  }
  return out;
}
