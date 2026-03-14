import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { createDb } from '../db/connection.js';
import { GitRepository } from '../git/git-repository.js';
import { AuditService } from './audit-service.js';
import { TemplateService } from './template-service.js';

function makeYaml(overrides?: Record<string, unknown>): string {
  return yaml.dump({
    id: 'tpl-test0001',
    name: 'Test Template',
    description: 'A test template',
    output_format: 'docx',
    carbone_template: 'test-template.docx',
    version: '1.0.0',
    fragments: [
      {
        key: 'intro',
        type: 'paragraph',
        domain: 'legal',
        lang: 'en',
        quality_min: 'draft',
        required: true,
        fallback: 'error',
        count: 1,
      },
    ],
    ...overrides,
  });
}

describe('TemplateService', () => {
  let dir: string;
  let service: TemplateService;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-tpl-'));
    const db = createDb(':memory:');
    const git = new GitRepository(dir);
    await git.init();
    const audit = new AuditService(db);
    service = new TemplateService(db, dir, audit);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('creates a template from .docx buffer and .yaml content', async () => {
    const docxBuffer = Buffer.from('PK mock docx content');
    const yamlContent = makeYaml();

    const result = await service.create(
      docxBuffer, yamlContent, 'test-template.docx', 'alice', 'admin',
    );

    expect(result.id).toBe('tpl-test0001');
    expect(result.template_path).toBe('templates/test-template.docx');
    expect(result.yaml_path).toBe('templates/tpl-test0001.yaml');
    expect(result.commit_hash).toMatch(/^[a-f0-9]+$/);
  });

  it('lists templates', async () => {
    const docxBuffer = Buffer.from('PK mock');
    await service.create(docxBuffer, makeYaml(), 'a.docx', 'alice', 'admin');
    await service.create(
      docxBuffer,
      makeYaml({ id: 'tpl-test0002', name: 'Second Template', version: '2.0.0' }),
      'b.docx', 'bob', 'editor',
    );

    const all = await service.list();
    expect(all.length).toBe(2);

    const filtered = await service.list({ output_format: 'docx' });
    expect(filtered.length).toBe(2);
  });

  it('gets a template by id with parsed YAML', async () => {
    const docxBuffer = Buffer.from('PK mock');
    await service.create(docxBuffer, makeYaml(), 'tpl.docx', 'alice', 'admin');

    const result = await service.getById('tpl-test0001');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test Template');
    expect(result!.yaml).not.toBeNull();
    expect(result!.yaml!.fragments.length).toBe(1);
    expect(result!.yaml!.fragments[0].key).toBe('intro');
  });

  it('returns null for unknown id', async () => {
    const result = await service.getById('tpl-nonexistent');
    expect(result).toBeNull();
  });

  it('updates a template', async () => {
    const docxBuffer = Buffer.from('PK mock');
    await service.create(docxBuffer, makeYaml(), 'tpl.docx', 'alice', 'admin');

    const updatedYaml = makeYaml({ version: '2.0.0', name: 'Updated Template' });
    const result = await service.update(
      'tpl-test0001', undefined, updatedYaml, 'alice', 'admin',
    );

    expect(result.commit_hash).toMatch(/^[a-f0-9]+$/);

    const fetched = await service.getById('tpl-test0001');
    expect(fetched!.name).toBe('Updated Template');
    expect(fetched!.version).toBe('2.0.0');
  });

  it('deletes a template', async () => {
    const docxBuffer = Buffer.from('PK mock');
    await service.create(docxBuffer, makeYaml(), 'tpl.docx', 'alice', 'admin');

    const result = await service.delete('tpl-test0001', 'alice', 'admin');
    expect(result.commit_hash).toMatch(/^[a-f0-9]+$/);

    const fetched = await service.getById('tpl-test0001');
    expect(fetched).toBeNull();
  });
});
