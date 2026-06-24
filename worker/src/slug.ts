/** German umlauts → ASCII before slugify (ä/Ä→ae, ö/Ö→oe, ü/Ü→ue, ß/ẞ→ss). */
export function transliterateGerman(value: string): string {
  return value
    .replace(/[Ää]/g, "ae")
    .replace(/[Öö]/g, "oe")
    .replace(/[Üü]/g, "ue")
    .replace(/[ßẞ]/g, "ss");
}

export function slugifyId(value: string): string {
  return transliterateGerman(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}
