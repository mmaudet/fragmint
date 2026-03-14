// packages/server/src/search/embedding-client.ts

export class EmbeddingClient {
  private readonly url: string;

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
    private readonly dimensions: number,
  ) {
    this.url = `${endpoint.replace(/\/$/, '')}/embeddings`;
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.callApi([text]);
    return vectors[0];
  }

  async embedBatch(texts: string[], batchSize = 32): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.callApi(batch);
      results.push(...vectors.slice(0, batch.length));
    }
    return results;
  }

  async ping(): Promise<{ ok: boolean; latency_ms: number }> {
    const start = Date.now();
    try {
      await this.callApi(['ping']);
      return { ok: true, latency_ms: Date.now() - start };
    } catch {
      return { ok: false, latency_ms: Date.now() - start };
    }
  }

  private async callApi(input: string[]): Promise<number[][]> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status}`);
    }

    const json = await response.json() as {
      data: Array<{ embedding: number[] }>;
    };

    return json.data.map(d => d.embedding);
  }
}
