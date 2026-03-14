import { describe, it, expect } from 'vitest';
import { buildCommitMessage } from './commit-message.js';

describe('buildCommitMessage', () => {
  it('formats a create message', () => {
    const msg = buildCommitMessage({
      action: 'create',
      type: 'introduction',
      domain: 'souveraineté',
      description: 'premier draft introduction fr',
      author: 'mmaudet',
      fragmentId: 'frag-abc123',
      qualityTransition: 'draft',
    });
    expect(msg).toContain('create(introduction/souveraineté): premier draft introduction fr');
    expect(msg).toContain('Author: mmaudet');
    expect(msg).toContain('Fragment-Id: frag-abc123');
  });

  it('includes quality transition when provided', () => {
    const msg = buildCommitMessage({
      action: 'approve',
      type: 'pricing',
      domain: 'twake',
      description: 'validated pricing',
      author: 'mmaudet',
      fragmentId: 'frag-xyz',
      qualityTransition: 'reviewed → approved',
    });
    expect(msg).toContain('Quality-Transition: reviewed → approved');
  });
});
