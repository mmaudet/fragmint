import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HarvesterService } from './harvester-service.js';
import { createDb } from '../db/connection.js';
import { harvestJobs, harvestCandidates } from '../db/schema.js';

describe('HarvesterService', () => {
  describe('extractBlockText', () => {
    const markdown = `# Introduction

This is the introduction to the document. It explains the purpose and scope.

## Setup Instructions

Follow these steps to install and configure the application properly.

## Conclusion

Thank you for reading this document.`;

    it('correctly extracts text between markers', () => {
      const result = HarvesterService.extractBlockText(
        markdown,
        'This is the introduction to the document',
        'Follow these steps to install',
      );
      expect(result).toContain('This is the introduction');
      expect(result).toContain('Follow these steps to install');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty string when markers not found', () => {
      const result = HarvesterService.extractBlockText(
        markdown,
        'This text does not exist anywhere in the document at all',
        'Neither does this other text fragment',
      );
      expect(result).toBe('');
    });
  });

  describe('detectLanguage', () => {
    it('returns fr for French text', () => {
      const frenchText =
        'Les nouvelles technologies sont dans une phase de croissance. La transformation digitale est un enjeu pour les entreprises qui doivent adapter leur stratégie pour rester compétitives dans un marché en constante évolution.';
      expect(HarvesterService.detectLanguage(frenchText)).toBe('fr');
    });

    it('returns en for English text', () => {
      const englishText =
        'The new technologies are in a growth phase. Digital transformation is a challenge for businesses that have to adapt their strategy to remain competitive in an ever-changing market.';
      expect(HarvesterService.detectLanguage(englishText)).toBe('en');
    });
  });

  describe('getJob', () => {
    it('returns null for nonexistent job', async () => {
      const db = createDb(':memory:');
      const service = new HarvesterService(
        db,
        {} as any,
        {} as any,
        {} as any,
        '/tmp/test-store',
      );

      const result = await service.getJob('hrv-nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('validate', () => {
    it('with accepted candidates creates fragments', async () => {
      const db = createDb(':memory:');
      const now = new Date().toISOString();

      // Insert a harvest job
      await db.insert(harvestJobs).values({
        id: 'hrv-test-001',
        status: 'done',
        files: JSON.stringify(['test.docx']),
        pipeline: 'docx-pandoc-llm',
        min_confidence: 0.5,
        stats: JSON.stringify({ total: 2, duplicates: 0, low_confidence: 0, valid: 2 }),
        created_by: 'testuser',
        created_at: now,
        updated_at: now,
      });

      // Insert candidates
      await db.insert(harvestCandidates).values({
        id: 'hcn-001',
        job_id: 'hrv-test-001',
        title: 'Test Candidate 1',
        body: 'This is test candidate body text.',
        type: 'introduction',
        domain: 'testing',
        lang: 'en',
        tags: JSON.stringify(['test']),
        confidence: 0.9,
        origin_source: 'test.docx',
        status: 'pending',
      });

      await db.insert(harvestCandidates).values({
        id: 'hcn-002',
        job_id: 'hrv-test-001',
        title: 'Test Candidate 2',
        body: 'Second candidate body.',
        type: 'argument',
        domain: 'testing',
        lang: 'en',
        tags: JSON.stringify([]),
        confidence: 0.85,
        origin_source: 'test.docx',
        status: 'pending',
      });

      // Mock fragmentService
      const mockFragmentService = {
        create: vi.fn().mockResolvedValue({ id: 'frag-created-001', file_path: 'fragments/testing/frag-created-001.md', commit_hash: 'abc123', quality: 'draft' }),
      };

      const service = new HarvesterService(
        db,
        {} as any,
        {} as any,
        mockFragmentService as any,
        '/tmp/test-store',
      );

      const result = await service.validate(
        'hrv-test-001',
        {
          accepted: ['hcn-001'],
          modified: [],
          merged: [],
          rejected: ['hcn-002'],
        },
        'testuser',
      );

      expect(result.committed).toBe(1);
      expect(result.rejected).toBe(1);
      expect(result.merged).toBe(0);

      // Verify fragmentService.create was called with correct params
      expect(mockFragmentService.create).toHaveBeenCalledOnce();
      expect(mockFragmentService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'introduction',
          domain: 'testing',
          body: 'This is test candidate body text.',
          origin: 'harvested',
        }),
        'testuser',
        'expert',
      );

      // Verify candidate statuses were updated
      const job = await service.getJob('hrv-test-001');
      expect(job).not.toBeNull();
      const accepted = job!.candidates.find((c) => c.id === 'hcn-001');
      const rejected = job!.candidates.find((c) => c.id === 'hcn-002');
      expect(accepted?.status).toBe('accepted');
      expect(accepted?.fragment_id).toBe('frag-created-001');
      expect(rejected?.status).toBe('rejected');
    });
  });
});
