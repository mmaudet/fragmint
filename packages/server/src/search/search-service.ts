// packages/server/src/search/search-service.ts
import { eq, like, and, or, desc, inArray, ne, isNull, lte, gte } from 'drizzle-orm';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import type { EmbeddingClient } from './embedding-client.js';
import type { FragmintMilvusClient, MilvusFilters } from './milvus-client.js';

export interface FragmentMetadata {
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  tags: string[];
  access_read: string[];
  created_at: string;
  updated_at: string;
}

export interface SearchFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality_min?: string;
  tags?: string[];
  collectionSlug?: string;
  valid_at?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  title: string | null;
  body_excerpt: string | null;
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  uses: number;
  updated_at: string;
}

const QUALITY_ORDER = ['draft', 'reviewed', 'approved'];

export interface EmbeddingPrefixes {
  document: string;
  query: string;
  cluster: string;
}

/**
 * Re-rank search results based on quality, freshness, and usage momentum.
 */
export function reRankResults(results: SearchResult[]): SearchResult[] {
  const now = Date.now();

  return results.map(r => {
    let adjustedScore = r.score;

    // Quality boost
    const qualityMultiplier =
      r.quality === 'approved' ? 1.0 :
      r.quality === 'reviewed' ? 0.95 :
      0.80;
    adjustedScore *= qualityMultiplier;

    // Freshness boost (if updated_at available)
    if (r.updated_at) {
      const ageMs = now - new Date(r.updated_at).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays <= 7) adjustedScore += 0.05;
      else if (ageDays <= 30) adjustedScore += 0.03;
      else if (ageDays <= 90) adjustedScore += 0.01;
    }

    // Usage momentum
    if (r.uses !== undefined) {
      if (r.uses > 10) adjustedScore += 0.02;
      else if (r.uses > 5) adjustedScore += 0.01;
    }

    return { ...r, score: adjustedScore };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Truncate text to fit within embedding model's context window.
 * Rough estimate: 1 token ≈ 4 chars for French/English.
 */
function truncateForEmbedding(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export class SearchService {
  private prefixes: EmbeddingPrefixes;
  private maxTokens: number;

  constructor(
    private db: FragmintDb,
    private embeddingClient: EmbeddingClient,
    private milvusClient: FragmintMilvusClient | null,
    options?: { prefixes?: EmbeddingPrefixes; maxTokens?: number },
  ) {
    this.prefixes = options?.prefixes ?? { document: 'search_document: ', query: 'search_query: ', cluster: 'clustering: ' };
    this.maxTokens = options?.maxTokens ?? 480;
  }

  async indexFragment(id: string, body: string, metadata: FragmentMetadata, partitionName?: string): Promise<void> {
    if (!this.milvusClient) return;

    try {
      const title = body.match(/^#\s+(.+)$/m)?.[1] ?? '';
      const rawText = `${title}\n\n${body}`;
      const vector = await this.embeddingClient.embed(
        this.prefixes.document + truncateForEmbedding(rawText, this.maxTokens)
      );

      await this.milvusClient.upsert([{
        id,
        vector,
        type: metadata.type,
        domain: metadata.domain,
        lang: metadata.lang,
        quality: metadata.quality,
        author: metadata.author,
        created_at: new Date(metadata.created_at).getTime(),
        updated_at: new Date(metadata.updated_at).getTime(),
        tags: metadata.tags,
        access_read: metadata.access_read,
        community_id: 0,
      }], partitionName);
    } catch (err) {
      console.warn(`Failed to index fragment ${id} in Milvus:`, err);
    }
  }

  async indexBatch(items: { id: string; body: string; metadata: FragmentMetadata }[]): Promise<{ indexed: number }> {
    if (!this.milvusClient || items.length === 0) return { indexed: 0 };

    let indexed = 0;
    try {
      const texts = items.map(item => {
        const title = item.body.match(/^#\s+(.+)$/m)?.[1] ?? '';
        const rawText = `${title}\n\n${item.body}`;
        return this.prefixes.document + truncateForEmbedding(rawText, this.maxTokens);
      });

      const vectors = await this.embeddingClient.embedBatch(texts);

      const milvusItems = items.map((item, i) => ({
        id: item.id,
        vector: vectors[i],
        type: item.metadata.type,
        domain: item.metadata.domain,
        lang: item.metadata.lang,
        quality: item.metadata.quality,
        author: item.metadata.author,
        created_at: new Date(item.metadata.created_at).getTime(),
        updated_at: new Date(item.metadata.updated_at).getTime(),
        tags: item.metadata.tags,
        access_read: item.metadata.access_read,
        community_id: 0,
      }));

      // Batch upsert in chunks of 100
      for (let i = 0; i < milvusItems.length; i += 100) {
        await this.milvusClient.upsert(milvusItems.slice(i, i + 100));
        indexed += Math.min(100, milvusItems.length - i);
      }
    } catch (err) {
      console.warn(`Failed to batch index in Milvus:`, err);
    }
    return { indexed };
  }

  async search(query: string, filters?: SearchFilters, limit = 20, partitionNames?: string[]): Promise<SearchResult[]> {
    // Try Milvus path
    if (this.milvusClient) {
      try {
        const vector = await this.embeddingClient.embed(
          this.prefixes.query + truncateForEmbedding(query, this.maxTokens)
        );
        const milvusFilters: MilvusFilters = {
          type: filters?.type,
          domain: filters?.domain,
          lang: filters?.lang,
          quality_min: filters?.quality_min,
        };
        const milvusResults = await this.milvusClient.search(vector, milvusFilters, limit, partitionNames);

        if (milvusResults.length > 0) {
          // Enrich from SQLite
          const ids = milvusResults.map(r => r.id);
          const conditions = [inArray(fragments.id, ids)];

          // Apply temporal filtering on Milvus results too
          if (filters?.valid_at) {
            conditions.push(
              or(isNull(fragments.valid_from), lte(fragments.valid_from, filters.valid_at))!
            );
            conditions.push(
              or(isNull(fragments.valid_until), gte(fragments.valid_until, filters.valid_at))!
            );
          }

          // Exclude deprecated
          conditions.push(ne(fragments.quality, 'deprecated'));

          const rows = await this.db.select().from(fragments)
            .where(and(...conditions));

          const rowMap = new Map(rows.map(r => [r.id, r]));
          const enriched = milvusResults
            .map(mr => {
              const row = rowMap.get(mr.id);
              if (!row) return null;
              return {
                id: row.id,
                score: mr.score,
                title: row.title,
                body_excerpt: row.body_excerpt,
                type: row.type,
                domain: row.domain,
                lang: row.lang,
                quality: row.quality,
                author: row.author,
                uses: row.uses,
                updated_at: row.updated_at,
              };
            })
            .filter((r): r is SearchResult => r !== null);
          return reRankResults(enriched);
        }
      } catch (err) {
        console.warn('Milvus search failed, falling back to SQLite:', err);
      }
    }

    // SQLite fallback
    return this.sqliteSearch(query, filters, limit);
  }

  async removeFromIndex(id: string): Promise<void> {
    if (!this.milvusClient) return;
    try {
      await this.milvusClient.delete(id);
    } catch (err) {
      console.warn(`Failed to remove fragment ${id} from Milvus:`, err);
    }
  }

  async status(): Promise<{ milvus: boolean; embedding: boolean; mode: 'milvus' | 'sqlite' }> {
    let milvusOk = false;
    if (this.milvusClient) {
      milvusOk = await this.milvusClient.ping();
    }
    const embeddingResult = await this.embeddingClient.ping();

    return {
      milvus: milvusOk,
      embedding: embeddingResult.ok,
      mode: milvusOk ? 'milvus' : 'sqlite',
    };
  }

  private async sqliteSearch(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
    const conditions = [];
    const q = `%${query}%`;
    conditions.push(or(like(fragments.title, q), like(fragments.body_excerpt, q)));

    if (filters?.type?.length) {
      conditions.push(inArray(fragments.type, filters.type));
    }
    if (filters?.domain?.length) {
      conditions.push(inArray(fragments.domain, filters.domain));
    }
    if (filters?.lang) {
      conditions.push(eq(fragments.lang, filters.lang));
    }
    if (filters?.quality_min) {
      const minIdx = QUALITY_ORDER.indexOf(filters.quality_min);
      if (minIdx > 0) {
        const allowed = QUALITY_ORDER.slice(minIdx);
        conditions.push(inArray(fragments.quality, allowed));
      }
    }
    if (filters?.tags?.length) {
      for (const tag of filters.tags) {
        conditions.push(like(fragments.tags, `%${tag}%`));
      }
    }

    // Filter by collection
    if (filters?.collectionSlug) {
      if (filters.collectionSlug === 'common') {
        conditions.push(or(eq(fragments.collection_slug, 'common'), isNull(fragments.collection_slug)));
      } else {
        conditions.push(eq(fragments.collection_slug, filters.collectionSlug));
      }
    }

    if (filters?.valid_at) {
      conditions.push(
        or(isNull(fragments.valid_from), lte(fragments.valid_from, filters.valid_at))
      );
      conditions.push(
        or(isNull(fragments.valid_until), gte(fragments.valid_until, filters.valid_at))
      );
    }

    // Always exclude deprecated
    conditions.push(ne(fragments.quality, 'deprecated'));

    const rows = await this.db.select().from(fragments)
      .where(and(...conditions))
      .orderBy(desc(fragments.uses))
      .limit(limit);

    const results = rows.map(row => ({
      id: row.id,
      score: 0, // no vector score for SQLite fallback
      title: row.title,
      body_excerpt: row.body_excerpt,
      type: row.type,
      domain: row.domain,
      lang: row.lang,
      quality: row.quality,
      author: row.author,
      uses: row.uses,
      updated_at: row.updated_at,
    }));
    return reRankResults(results);
  }
}
