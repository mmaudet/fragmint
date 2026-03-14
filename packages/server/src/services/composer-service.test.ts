import { describe, it, expect } from 'vitest';
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

describe('ComposerService.parseStructuredTags', () => {
  it('parses key:value tags into an object', () => {
    const tags = ['produit:Twake Workplace', 'pu:4.50', 'unite:utilisateur/mois'];
    const result = ComposerService.parseStructuredTags(tags);
    expect(result).toEqual({
      produit: 'Twake Workplace',
      pu: '4.50',
      unite: 'utilisateur/mois',
    });
  });

  it('ignores tags without a colon', () => {
    const tags = ['simple-tag', 'produit:Test', 'another'];
    const result = ComposerService.parseStructuredTags(tags);
    expect(result).toEqual({ produit: 'Test' });
  });

  it('handles colons in values', () => {
    const tags = ['description:Support 24/7 : dédié'];
    const result = ComposerService.parseStructuredTags(tags);
    expect(result).toEqual({ description: 'Support 24/7 : dédié' });
  });

  it('returns empty object for empty tags', () => {
    expect(ComposerService.parseStructuredTags([])).toEqual({});
  });
});

describe('ComposerService.buildTemplateData', () => {
  it('builds data with single-count fragments', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('intro', [
      { id: 'frag-001', body: 'Welcome text', quality: 'approved', score: 0.95 },
    ]);

    const result = ComposerService.buildTemplateData(
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

  it('builds data with multi-count fragments as arrays', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('references', [
      { id: 'frag-001', body: 'Reference 1', quality: 'approved', score: 0.9 },
      { id: 'frag-002', body: 'Reference 2', quality: 'reviewed', score: 0.85 },
    ]);

    const result = ComposerService.buildTemplateData(resolved, {});

    expect(Array.isArray(result.fragments.references)).toBe(true);
    expect(result.fragments.references).toHaveLength(2);
  });

  it('injects structured_data at top level', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('intro', [
      { id: 'frag-001', body: 'Text', quality: 'draft', score: 1.0 },
    ]);

    const structuredData = {
      pricing: { unit_price: 100, total: 5000 },
    };

    const result = ComposerService.buildTemplateData(resolved, {}, structuredData);

    expect(result.pricing).toEqual({ unit_price: 100, total: 5000 });
    expect(result.fragments).toBeDefined();
    expect(result.metadata).toBeDefined();
  });

  it('merges structured tags into fragment objects', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('produits', [
      { id: 'frag-001', body: 'Description Twake', quality: 'draft', score: 0.9, tags: ['produit:Twake', 'pu:4.50'] },
      { id: 'frag-002', body: 'Description OpenRAG', quality: 'draft', score: 0.8, tags: ['produit:OpenRAG', 'pu:15000'] },
    ]);

    const result = ComposerService.buildTemplateData(resolved, {});

    expect(result.fragments.produits[0].produit).toBe('Twake');
    expect(result.fragments.produits[0].pu).toBe('4.50');
    expect(result.fragments.produits[1].produit).toBe('OpenRAG');
    expect(result.fragments.produits[1].pu).toBe('15000');
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
    expect(context.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
