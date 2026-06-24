/** Remove bulky full-page screenshot data; viewport capture stays in final-screenshot. */
export function slimLighthouseReport(lighthouse: Record<string, unknown>): Record<string, unknown> {
  const out = { ...lighthouse };
  delete out.fullPageScreenshot;
  const audits = out.audits;
  if (audits && typeof audits === "object") {
    const trimmed = { ...(audits as Record<string, unknown>) };
    delete trimmed["full-page-screenshot"];
    out.audits = trimmed;
  }
  return out;
}
