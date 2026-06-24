/** Strip screenshot data from Lighthouse JSON when store_screenshots is off. */
export function slimLighthouseReport(
  lighthouse: Record<string, unknown>,
  options?: { storeScreenshots?: boolean }
): Record<string, unknown> {
  if (options?.storeScreenshots) return lighthouse;
  const out = { ...lighthouse };
  delete out.fullPageScreenshot;
  const audits = out.audits;
  if (audits && typeof audits === "object") {
    const trimmed = { ...(audits as Record<string, unknown>) };
    delete trimmed["full-page-screenshot"];
    delete trimmed["final-screenshot"];
    out.audits = trimmed;
  }
  return out;
}
