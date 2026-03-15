// packages/server/src/search/milvus-client.ts
import { MilvusClient as MilvusSdk, DataType } from '@zilliz/milvus2-sdk-node';

export interface MilvusFragment {
  id: string;
  vector: number[];
  type: string;
  domain: string;
  lang: string;
  quality: string;
  author: string;
  created_at: number;   // unix timestamp
  updated_at: number;   // unix timestamp
  tags: string[];
  access_read: string[];
  community_id: number;
}

export interface MilvusSearchResult {
  id: string;
  score: number;
}

export interface MilvusFilters {
  type?: string[];
  domain?: string[];
  lang?: string;
  quality_min?: string;
  tags?: string[];
}

const QUALITY_ORDER = ['draft', 'reviewed', 'approved'];

function buildFilterExpr(filters: MilvusFilters): string {
  const parts: string[] = [];

  if (filters.type?.length) {
    const vals = filters.type.map(t => `"${t}"`).join(', ');
    parts.push(`type in [${vals}]`);
  }
  if (filters.domain?.length) {
    const vals = filters.domain.map(d => `"${d}"`).join(', ');
    parts.push(`domain in [${vals}]`);
  }
  if (filters.lang) {
    parts.push(`lang == "${filters.lang}"`);
  }
  if (filters.quality_min) {
    const minIdx = QUALITY_ORDER.indexOf(filters.quality_min);
    if (minIdx > 0) {
      const allowed = QUALITY_ORDER.slice(minIdx).map(q => `"${q}"`).join(', ');
      parts.push(`quality in [${allowed}]`);
    }
  }

  // Always exclude deprecated
  parts.push(`quality != "deprecated"`);

  return parts.join(' and ');
}

export class FragmintMilvusClient {
  private sdk: MilvusSdk;

  constructor(
    private readonly address: string,
    private readonly collectionName: string,
    private readonly dimensions: number,
  ) {
    this.sdk = new MilvusSdk({ address });
  }

  async ensureCollection(): Promise<void> {
    const exists = await this.sdk.hasCollection({ collection_name: this.collectionName });
    if (exists.value) return;

    await this.sdk.createCollection({
      collection_name: this.collectionName,
      fields: [
        { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
        { name: 'vector', data_type: DataType.FloatVector, dim: this.dimensions },
        { name: 'type', data_type: DataType.VarChar, max_length: 32 },
        { name: 'domain', data_type: DataType.VarChar, max_length: 128 },
        { name: 'lang', data_type: DataType.VarChar, max_length: 8 },
        { name: 'quality', data_type: DataType.VarChar, max_length: 16 },
        { name: 'author', data_type: DataType.VarChar, max_length: 128 },
        { name: 'created_at', data_type: DataType.Int64 },
        { name: 'updated_at', data_type: DataType.Int64 },
        { name: 'tags', data_type: DataType.JSON },
        { name: 'access_read', data_type: DataType.JSON },
        { name: 'community_id', data_type: DataType.Int64 },
      ],
    });

    await this.sdk.createIndex({
      collection_name: this.collectionName,
      field_name: 'vector',
      index_type: 'IVF_FLAT',
      metric_type: 'COSINE',
      params: { nlist: 128 },
    });

    await this.sdk.loadCollection({ collection_name: this.collectionName });
  }

  async upsert(items: MilvusFragment[], partitionName?: string): Promise<void> {
    if (items.length === 0) return;
    await this.sdk.upsert({
      collection_name: this.collectionName,
      ...(partitionName ? { partition_name: partitionName } : {}),
      data: items,
    });
  }

  async search(vector: number[], filters: MilvusFilters, limit: number, partitionNames?: string[]): Promise<MilvusSearchResult[]> {
    const filterExpr = buildFilterExpr(filters);
    const results = await this.sdk.search({
      collection_name: this.collectionName,
      ...(partitionNames?.length ? { partition_names: partitionNames } : {}),
      vector,
      limit,
      filter: filterExpr,
      output_fields: ['id'],
    });

    return (results.results || []).map((r: any) => ({
      id: r.id as string,
      score: r.score as number,
    }));
  }

  async delete(id: string): Promise<void> {
    await this.sdk.delete({
      collection_name: this.collectionName,
      filter: `id == "${id}"`,
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.sdk.checkHealth();
      return true;
    } catch {
      return false;
    }
  }
}
