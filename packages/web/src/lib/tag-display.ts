/**
 * Returns the display label for a tag, stripping the category prefix if present.
 * e.g. "produit:linshare" → "linshare", "cloud" → "cloud"
 */
export function tagDisplayLabel(tag: string): string {
  const colonIdx = tag.indexOf(':');
  return colonIdx !== -1 ? tag.slice(colonIdx + 1) : tag;
}
