import { describe, it, expect } from 'vitest';
import {
  TemplateYamlSchema,
  FragmentSlotSchema,
  ComposeRequestSchema,
  ComposeResponseSchema,
} from './template.js';

describe('TemplateYamlSchema', () => {
  const validTemplate = {
    id: 'tpl-proposal-001',
    name: 'Commercial Proposal',
    description: 'A standard commercial proposal template',
    output_format: 'docx',
    author: 'mmaudet',
    carbone_template: 'proposal.docx',
    version: '1.0.0',
    fragments: [
      { key: 'intro', type: 'introduction', domain: 'commercial', lang: 'fr' },
      { key: 'pricing', type: 'pricing', domain: 'commercial', lang: 'fr' },
    ],
  };

  it('validates a correct template YAML', () => {
    const result = TemplateYamlSchema.safeParse(validTemplate);
    expect(result.success).toBe(true);
  });

  it('rejects invalid id prefix (not starting with tpl-)', () => {
    const result = TemplateYamlSchema.safeParse({ ...validTemplate, id: 'bad-id' });
    expect(result.success).toBe(false);
  });

  it('rejects missing fragments array', () => {
    const { fragments, ...noFragments } = validTemplate;
    const result = TemplateYamlSchema.safeParse(noFragments);
    expect(result.success).toBe(false);
  });

  it('accepts optional description and author', () => {
    const { description, author, ...minimal } = validTemplate;
    const result = TemplateYamlSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe('FragmentSlotSchema', () => {
  it('applies defaults (quality_min=draft, fallback=error, count=1, required=true)', () => {
    const result = FragmentSlotSchema.parse({
      key: 'intro',
      type: 'introduction',
      domain: 'commercial',
      lang: 'fr',
    });
    expect(result.quality_min).toBe('draft');
    expect(result.fallback).toBe('error');
    expect(result.count).toBe(1);
    expect(result.required).toBe(true);
  });
});

describe('ComposeRequestSchema', () => {
  it('validates complete request (context + overrides + structured_data + output)', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { client_name: 'LINAGORA', date: '2026-03-14' },
      overrides: { intro: 'frag-custom-123' },
      structured_data: { pricing: { unit_price: 100 } },
      output: { format: 'docx', filename: 'proposal.docx' },
    });
    expect(result.success).toBe(true);
  });

  it('validates minimal request (context only)', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { client_name: 'LINAGORA' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unsupported output format (xlsx)', () => {
    const result = ComposeRequestSchema.safeParse({
      context: { client_name: 'LINAGORA' },
      output: { format: 'xlsx' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ComposeResponseSchema', () => {
  it('validates complete response', () => {
    const result = ComposeResponseSchema.safeParse({
      document_url: 'https://storage.example.com/docs/proposal-001.docx',
      expires_at: '2026-03-15T00:00:00Z',
      template: { id: 'tpl-proposal-001', name: 'Commercial Proposal', version: '1.0.0' },
      context: { client_name: 'LINAGORA' },
      resolved: [
        { key: 'intro', fragment_id: 'frag-abc123', score: 0.95, quality: 'approved' },
      ],
      skipped: [],
      generated: [],
      structured_data: { pricing: { total: 5000 } },
      warnings: [],
      render_ms: 245,
    });
    expect(result.success).toBe(true);
  });
});
