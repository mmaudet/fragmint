// packages/mcp/src/tools/cache-tools.ts
import type { FragmintApiClient } from '../client.js';
import type { ToolDefinition, ToolHandler } from '../types.js';
import { toolSuccess, toolError } from '../types.js';
import { cache, TTL } from '../cache/cache-manager.js';

// ── cache_status ─────────────────────────────────────────────────────────────

export const cacheStatusDefinition: ToolDefinition = {
  name: 'cache_status',
  description:
    'Show local cache statistics: hit rate, entry count, expiry status. Use to diagnose cache effectiveness during a session.',
  inputSchema: { type: 'object', properties: {} },
};

export function cacheStatusHandler(_client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const stats = cache.stats();
      const summary = [
        `Cache entries: ${stats.totalEntries} total (${stats.expiredEntries} expired)`,
        `Hit rate: ${stats.hitRate} (${stats.hits} hits / ${stats.misses} misses)`,
        `Invalidations: ${stats.invalidations}`,
      ].join('\n');
      return toolSuccess({ ...stats, summary });
    } catch (err) {
      return toolError(`cache_status failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

// ── cache_sync ────────────────────────────────────────────────────────────────

export const cacheSyncDefinition: ToolDefinition = {
  name: 'cache_sync',
  description:
    'Force refresh the local cache from the Fragmint backend. Use "index" to refresh only the fragment index, or omit scope to purge all expired entries and let them be lazily refetched.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        enum: ['index', 'fragments', 'references', 'all'],
        description:
          '"index" clears the index cache, "fragments" clears individual fragment cache, "references" clears subjects/entities/tags, "all" clears everything.',
      },
      collection_slug: {
        type: 'string',
        description: 'Limit sync to a specific collection (optional, default: all collections).',
      },
    },
  },
};

export function cacheSyncHandler(client: FragmintApiClient): ToolHandler {
  return async (args) => {
    try {
      const scope = (args.scope as string | undefined) ?? 'all';
      const slug = args.collection_slug as string | undefined;

      let cleared = 0;
      const prefix = slug ? `%:${slug}:%` : undefined;

      switch (scope) {
        case 'index':
          cleared += cache.clear(slug ? `index:${slug}:%` : 'index:%');
          break;
        case 'fragments':
          cleared += cache.clear(slug ? `frag:${slug}:%` : 'frag:%');
          cleared += cache.clear(slug ? `search:${slug}:%` : 'search:%');
          cleared += cache.clear(slug ? `inventory:${slug}:%` : 'inventory:%');
          cleared += cache.clear(slug ? `lineage:${slug}:%` : 'lineage:%');
          break;
        case 'references':
          cleared += cache.clear('ref:%');
          cleared += cache.clear('collections');
          break;
        case 'all':
        default:
          cleared += cache.clear();
          break;
      }

      // Also eagerly warm the index if scope includes it
      if (scope === 'index' || scope === 'all') {
        const targetSlug = slug ?? 'common';
        try {
          const markdown = await client.getText(`/v1/index?format=md`);
          cache.set(`index:${targetSlug}:md`, markdown, TTL.INDEX);
          return toolSuccess({
            cleared,
            warmed: `index:${targetSlug}:md`,
            message: `Cleared ${cleared} entries and re-warmed index cache.`,
          });
        } catch {
          // Warm failed (backend maybe offline) — still report clear success
        }
      }

      return toolSuccess({
        cleared,
        message: `Cleared ${cleared} cache entries for scope="${scope}"${slug ? ` collection="${slug}"` : ''}.`,
      });
    } catch (err) {
      return toolError(`cache_sync failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

// ── cache_clear ───────────────────────────────────────────────────────────────

export const cacheClearDefinition: ToolDefinition = {
  name: 'cache_clear',
  description:
    'Purge the local Fragmint cache entirely. All subsequent reads will fetch fresh data from the backend. Use when the backend corpus has changed significantly.',
  inputSchema: { type: 'object', properties: {} },
};

export function cacheClearHandler(_client: FragmintApiClient): ToolHandler {
  return async () => {
    try {
      const removed = cache.clear();
      return toolSuccess({
        removed,
        message: `Cache cleared — ${removed} entries removed. All reads will fetch fresh data.`,
      });
    } catch (err) {
      return toolError(`cache_clear failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}
