// packages/server/src/search/search-service.ts
import { eq, like, and, or, desc, inArray, ne } from 'drizzle-orm';
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
}

const QUALITY_ORDER = ['draft', 'reviewed', 'approved'];

export class SearchService {
  constructor(
    private db: FragmintDb,
    private embeddingClient: EmbeddingClient,
    private milvusClient: FragmintMilvusClient | null,
  ) {}

  async indexFragment(id: string, body: string, metadata: FragmentMetadata): Promise<void> {
    if (!this.milvusClient) return;

    try {
      const title = body.match(/^#\s+(.+)$/m)?.[1] ?? '';
      const vector = await this.embeddingClient.embed(`${title}\n\n${body}`);

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
      }]);
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
        return `${title}\n\n${item.body}`;
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

  async search(query: string, filters?: SearchFilters, limit = 20): Promise<SearchResult[]> {
    // Try Milvus path
    if (this.milvusClient) {
      try {
        const vector = await this.embeddingClient.embed(query);
        const milvusFilters: MilvusFilters = {
          type: filters?.type,
          domain: filters?.domain,
          lang: filters?.lang,
          quality_min: filters?.quality_min,
        };
        const milvusResults = await this.milvusClient.search(vector, milvusFilters, limit);

        if (milvusResults.length > 0) {
          // Enrich from SQLite
          const ids = milvusResults.map(r => r.id);
          const rows = await this.db.select().from(fragments)
            .where(inArray(fragments.id, ids));

          const rowMap = new Map(rows.map(r => [r.id, r]));
          return milvusResults
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
              };
            })
            .filter((r): r is SearchResult => r !== null);
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

    // Always exclude deprecated
    conditions.push(ne(fragments.quality, 'deprecated'));

    const rows = await this.db.select().from(fragments)
      .where(and(...conditions))
      .orderBy(desc(fragments.uses))
      .limit(limit);

    return rows.map(row => ({
      id: row.id,
      score: 0, // no score for SQLite fallback
      title: row.title,
      body_excerpt: row.body_excerpt,
      type: row.type,
      domain: row.domain,
      lang: row.lang,
      quality: row.quality,
      author: row.author,
      uses: row.uses,
    }));
  }
}
