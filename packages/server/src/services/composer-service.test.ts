import { describe, it, expect, vi } from 'vitest';
import { ComposerService } from './composer-service.js';

describe('ComposerService.resolveContextVars', () => {
  it('replaces {{context.lang}} with context value', () => {
    const result = ComposerService.resolveContextVars(
      '{{context.lang}}',
      { lang: 'fr' },
    );
    expect(result).toBe('fr');
  });

  it('replaces multiple context vars in a string', () => {
    const result = ComposerService.resolveContextVars(
      '{{context.lang}}-{{context.domain}}',
      { lang: 'fr', domain: 'commercial' },
    );
    expect(result).toBe('fr-commercial');
  });

  it('leaves literal strings unchanged', () => {
    const result = ComposerService.resolveContextVars(
      'plain-string',
      { lang: 'fr' },
    );
    expect(result).toBe('plain-string');
  });

  it('replaces unknown context vars with empty string', () => {
    const result = ComposerService.resolveContextVars(
      '{{context.missing}}',
      {},
    );
    expect(result).toBe('');
  });
});

describe('ComposerService.buildCarboneJson', () => {
  it('builds JSON with single-count fragments', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number }>>();
    resolved.set('intro', [
      { id: 'frag-001', body: 'Welcome text', quality: 'approved', score: 0.95 },
    ]);

    const result = ComposerService.buildCarboneJson(
      resolved,
      { client: 'LINAGORA' },
    );

    expect(result.fragments.intro).toEqual({
      body: 'Welcome text',
      id: 'frag-001',
      quality: 'approved',
    });
    expect(result.metadata.client).toBe('LINAGORA');
    expect(result.metadata.generated_at).toBeDefined();
  });

  it('builds JSON with multi-count fragments as arrays', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number }>>();
    resolved.set('references', [
      { id: 'frag-001', body: 'Reference 1', quality: 'approved', score: 0.9 },
      { id: 'frag-002', body: 'Reference 2', quality: 'reviewed', score: 0.85 },
    ]);

    const result = ComposerService.buildCarboneJson(resolved, {});

    expect(Array.isArray(result.fragments.references)).toBe(true);
    expect(result.fragments.references).toHaveLength(2);
    expect(result.fragments.references[0]).toEqual({
      body: 'Reference 1',
      id: 'frag-001',
      quality: 'approved',
    });
    expect(result.fragments.references[1]).toEqual({
      body: 'Reference 2',
      id: 'frag-002',
      quality: 'reviewed',
    });
  });

  it('injects structured_data at top level', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number }>>();
    resolved.set('intro', [
      { id: 'frag-001', body: 'Text', quality: 'draft', score: 1.0 },
    ]);

    const structuredData = {
      pricing: { unit_price: 100, total: 5000 },
      company: { name: 'LINAGORA' },
    };

    const result = ComposerService.buildCarboneJson(resolved, {}, structuredData);

    expect(result.pricing).toEqual({ unit_price: 100, total: 5000 });
    expect(result.company).toEqual({ name: 'LINAGORA' });
    expect(result.fragments).toBeDefined();
    expect(result.metadata).toBeDefined();
  });
});

describe('ComposerService.validateContext', () => {
  it('passes with valid required fields', () => {
    const context: Record<string, any> = { client_name: 'LINAGORA', lang: 'fr' };
    const schema = {
      client_name: { type: 'string', required: true },
      lang: { type: 'string', required: true },
    };

    expect(() => ComposerService.validateContext(context, schema)).not.toThrow();
  });

  it('throws on missing required field', () => {
    const context: Record<string, any> = { lang: 'fr' };
    const schema = {
      client_name: { type: 'string', required: true },
      lang: { type: 'string', required: true },
    };

    expect(() => ComposerService.validateContext(context, schema))
      .toThrow('Missing required context field: client_name');
  });

  it('applies default values', () => {
    const context: Record<string, any> = { client_name: 'LINAGORA' };
    const schema = {
      client_name: { type: 'string', required: true },
      lang: { type: 'string', default: 'fr' },
    };

    ComposerService.validateContext(context, schema);
    expect(context.lang).toBe('fr');
  });

  it('applies "today" default as YYYY-MM-DD', () => {
    const context: Record<string, any> = {};
    const schema = {
      date: { type: 'date', default: 'today' },
    };

    ComposerService.validateContext(context, schema);
    // Should be a valid YYYY-MM-DD string
    expect(context.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should be today's date
    expect(context.date).toBe(new Date().toISOString().slice(0, 10));
  });

  it('validates enum constraints', () => {
    const context: Record<string, any> = { lang: 'de' };
    const schema = {
      lang: { type: 'string', required: true, enum: ['fr', 'en'] },
    };

    expect(() => ComposerService.validateContext(context, schema))
      .toThrow("Context field 'lang' must be one of: fr, en. Got: de");
  });

  it('does not throw for optional fields that are missing without default', () => {
    const context: Record<string, any> = {};
    const schema = {
      notes: { type: 'string' },
    };

    expect(() => ComposerService.validateContext(context, schema)).not.toThrow();
  });
});
