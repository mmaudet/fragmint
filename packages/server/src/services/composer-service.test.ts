import { describe, it, expect } from 'vitest';
import { ComposerService, formatFrenchNumber } from './composer-service.js';

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

describe('formatFrenchNumber', () => {
  it('formats 1234.5 with space separator and comma decimal', () => {
    // Node.js fr-FR uses narrow no-break space (U+202F) as thousands separator
    const result = formatFrenchNumber(1234.5);
    // Normalize any whitespace-like character to a regular space for comparison
    const normalized = result.replace(/\s/g, ' ');
    expect(normalized).toBe('1 234,50');
  });

  it('formats 15000 as 15 000,00', () => {
    const result = formatFrenchNumber(15000);
    const normalized = result.replace(/\s/g, ' ');
    expect(normalized).toBe('15 000,00');
  });

  it('formats 0 as 0,00', () => {
    expect(formatFrenchNumber(0)).toBe('0,00');
  });

  it('formats 4.5 as 4,50', () => {
    expect(formatFrenchNumber(4.5)).toBe('4,50');
  });

  it('formats 1000000 with spaces', () => {
    const result = formatFrenchNumber(1000000);
    const normalized = result.replace(/\s/g, ' ');
    expect(normalized).toBe('1 000 000,00');
  });
});

describe('ComposerService.buildTemplateData with quantities', () => {
  it('computes qte, total, and formats pu for pricing fragments', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('produits', [
      { id: 'frag-001', body: 'Twake Workplace', quality: 'approved', score: 0.9, tags: ['produit:Twake Workplace', 'pu:4.50', 'unite:utilisateur/mois'] },
      { id: 'frag-002', body: 'OpenRAG', quality: 'approved', score: 0.8, tags: ['produit:OpenRAG', 'pu:15000', 'unite:instance/an'] },
    ]);

    const structuredData = {
      quantities: {
        'frag-001': 500,
        'frag-002': 1,
      },
    };

    const result = ComposerService.buildTemplateData(resolved, {}, structuredData);

    // Fragment frag-001: pu=4.50, qte=500, total=2250
    const p0 = result.fragments.produits[0];
    expect(p0.produit).toBe('Twake Workplace');
    expect(p0.qte).toBe(500);
    expect(p0.pu.replace(/\s/g, ' ')).toBe('4,50');
    expect(p0.total.replace(/\s/g, ' ')).toBe('2 250,00');
    expect(p0.unite).toBe('utilisateur/mois');

    // Fragment frag-002: pu=15000, qte=1, total=15000
    const p1 = result.fragments.produits[1];
    expect(p1.produit).toBe('OpenRAG');
    expect(p1.qte).toBe(1);
    expect(p1.pu.replace(/\s/g, ' ')).toBe('15 000,00');
    expect(p1.total.replace(/\s/g, ' ')).toBe('15 000,00');
  });

  it('leaves pu as raw string when no quantities are provided', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('produits', [
      { id: 'frag-001', body: 'Twake', quality: 'draft', score: 0.9, tags: ['produit:Twake', 'pu:4.50'] },
    ]);

    const result = ComposerService.buildTemplateData(resolved, {});

    // No quantities → pu stays as the raw tag string
    expect(result.fragments.produits.pu).toBe('4.50');
    expect(result.fragments.produits.qte).toBeUndefined();
    expect(result.fragments.produits.total).toBeUndefined();
  });

  it('leaves pu as raw string when fragment id is not in quantities map', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('produits', [
      { id: 'frag-001', body: 'Twake', quality: 'draft', score: 0.9, tags: ['produit:Twake', 'pu:4.50'] },
    ]);

    const structuredData = {
      quantities: {
        'frag-999': 100, // different fragment
      },
    };

    const result = ComposerService.buildTemplateData(resolved, {}, structuredData);

    // frag-001 not in quantities → pu stays raw
    expect(result.fragments.produits.pu).toBe('4.50');
    expect(result.fragments.produits.qte).toBeUndefined();
  });

  it('does not add pricing fields to fragments without pu tag', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('intro', [
      { id: 'frag-010', body: 'Intro text', quality: 'approved', score: 0.95, tags: ['domain:commercial'] },
    ]);

    const structuredData = {
      quantities: {
        'frag-010': 5,
      },
    };

    const result = ComposerService.buildTemplateData(resolved, {}, structuredData);

    expect(result.fragments.intro.qte).toBeUndefined();
    expect(result.fragments.intro.total).toBeUndefined();
  });

  it('quantities map is also available as top-level structured_data', () => {
    const resolved = new Map<string, Array<{ id: string; body: string; quality: string; score: number; tags?: string[] }>>();
    resolved.set('intro', [
      { id: 'frag-001', body: 'Text', quality: 'draft', score: 1.0 },
    ]);

    const structuredData = {
      quantities: { 'frag-001': 10 },
      extra: 'value',
    };

    const result = ComposerService.buildTemplateData(resolved, {}, structuredData);

    expect(result.quantities).toEqual({ 'frag-001': 10 });
    expect(result.extra).toBe('value');
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
