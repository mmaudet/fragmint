import { describe, it, expect } from 'vitest';
import { chunkMarkdown, deduplicateBlocks } from './harvester-pipeline.js';

describe('harvester-pipeline pure functions', () => {
  describe('chunkMarkdown', () => {
    it('returns single chunk for short markdown', () => {
      expect(chunkMarkdown('hello world')).toHaveLength(1);
    });

    it('splits long markdown into multiple chunks', () => {
      const long = 'Lorem ipsum dolor sit amet. '.repeat(500); // ~14000 chars
      const chunks = chunkMarkdown(long);
      expect(chunks.length).toBeGreaterThan(1);
    });
  });

  describe('deduplicateBlocks', () => {
    it('removes prefix duplicates', () => {
      const blocks = [
        { body: 'LinShare est une solution open source.', title: 'A' },
        { body: 'LinShare est une solution open source.', title: 'B' },
        { body: 'Twake est une autre solution.', title: 'C' },
      ];
      expect(deduplicateBlocks(blocks)).toHaveLength(2);
    });
  });
});
