// packages/mcp/src/url-helpers.ts

/**
 * Build a collection-scoped URL path for the fragments API.
 *
 * @param collectionSlug - Collection slug (defaults to 'common')
 * @param path - The path suffix (e.g. '/fragments', '/fragments/frag-123')
 * @returns Full API path like '/v1/collections/common/fragments'
 */
export function fragmentUrl(collectionSlug: string | undefined, path: string): string {
  const slug = collectionSlug || 'common';
  return `/v1/collections/${slug}${path}`;
}
