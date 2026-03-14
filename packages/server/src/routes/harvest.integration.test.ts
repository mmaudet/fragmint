import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, getAuthToken } from '../test-helpers.js';
import { harvestJobs, harvestCandidates } from '../db/schema.js';
import { eq } from 'drizzle-orm';

describe('Harvest routes', () => {
  let server: any;
  let token: string;

  const jobId = 'hrv-test-job-001';
  const cand1Id = 'hcn-test-cand-001';
  const cand2Id = 'hcn-test-cand-002';

  beforeAll(async () => {
    server = await createTestServer();
    token = await getAuthToken(server.app);

    const now = new Date().toISOString();

    // Insert a harvest job directly into the DB
    await server.db.insert(harvestJobs).values({
      id: jobId,
      status: 'done',
      files: JSON.stringify(['test-doc.docx']),
      pipeline: 'docx-pandoc-llm',
      min_confidence: 0.5,
      stats: JSON.stringify({ total: 2, duplicates: 0, low_confidence: 0, valid: 2 }),
      error: null,
      created_by: 'mmaudet',
      created_at: now,
      updated_at: now,
    });

    // Insert 2 harvest candidates
    await server.db.insert(harvestCandidates).values({
      id: cand1Id,
      job_id: jobId,
      title: 'Candidate One',
      body: 'This is the body of the first candidate fragment.',
      type: 'paragraph',
      domain: 'test',
      lang: 'en',
      tags: JSON.stringify(['integration', 'test']),
      confidence: 0.85,
      origin_source: 'test-doc.docx',
      origin_page: null,
      duplicate_of: null,
      duplicate_score: null,
      status: 'pending',
      fragment_id: null,
    });

    await server.db.insert(harvestCandidates).values({
      id: cand2Id,
      job_id: jobId,
      title: 'Candidate Two',
      body: 'This is the body of the second candidate fragment.',
      type: 'paragraph',
      domain: 'test',
      lang: 'en',
      tags: JSON.stringify(['integration', 'test']),
      confidence: 0.72,
      origin_source: 'test-doc.docx',
      origin_page: null,
      duplicate_of: null,
      duplicate_score: null,
      status: 'pending',
      fragment_id: null,
    });
  });

  afterAll(async () => {
    await server.app.close();
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('GET /v1/harvest/:jobId returns the job with 2 candidates', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: `/v1/harvest/${jobId}`,
      headers: auth(),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.id).toBe(jobId);
    expect(body.data.status).toBe('done');
    expect(body.data.candidates).toHaveLength(2);
    expect(body.data.candidates.map((c: any) => c.id).sort()).toEqual(
      [cand1Id, cand2Id].sort(),
    );
  });

  it('GET /v1/harvest/:jobId returns 404 for unknown job', async () => {
    const res = await server.app.inject({
      method: 'GET',
      url: '/v1/harvest/hrv-does-not-exist',
      headers: auth(),
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Harvest job not found');
  });

  it('POST /v1/harvest/:jobId/validate accepts and rejects candidates', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: `/v1/harvest/${jobId}/validate`,
      headers: { ...auth(), 'Content-Type': 'application/json' },
      payload: {
        accepted: [cand1Id],
        rejected: [cand2Id],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.committed).toBe(1);
    expect(body.data.rejected).toBe(1);
  });

  it('accepted candidate has status=accepted and a fragment_id', async () => {
    const rows = await server.db
      .select()
      .from(harvestCandidates)
      .where(eq(harvestCandidates.id, cand1Id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('accepted');
    expect(rows[0].fragment_id).toBeTruthy();
  });

  it('rejected candidate has status=rejected', async () => {
    const rows = await server.db
      .select()
      .from(harvestCandidates)
      .where(eq(harvestCandidates.id, cand2Id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('rejected');
  });
});
