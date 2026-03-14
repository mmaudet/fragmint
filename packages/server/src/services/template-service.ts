// packages/server/src/services/template-service.ts
import { eq, desc } from 'drizzle-orm';
import { join, relative } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import type { FragmintDb } from '../db/connection.js';
import { templates } from '../db/schema.js';
import { GitRepository } from '../git/git-repository.js';
import { TemplateYamlSchema, type TemplateYaml } from '../schema/template.js';
import { AuditService } from './audit-service.js';

export class TemplateService {
  private git: GitRepository;

  constructor(
    private db: FragmintDb,
    private storePath: string,
    private audit: AuditService,
  ) {
    this.git = new GitRepository(storePath);
  }

  getGit(): GitRepository {
    return this.git;
  }

  getTemplatePath(row: { template_path: string }): string {
    return join(this.storePath, row.template_path);
  }

  async create(
    docxBuffer: Buffer,
    yamlContent: string,
    docxFilename: string,
    author: string,
    authorRole: string,
    ip?: string,
  ) {
    // Sanitize filename to prevent path traversal
    if (docxFilename.includes('..') || docxFilename.includes('/')) {
      throw new Error('Invalid filename: must not contain ".." or "/"');
    }

    // Parse and validate YAML
    const yaml = await import('js-yaml');
    const parsed = yaml.load(yamlContent);
    const validated = TemplateYamlSchema.parse(parsed);

    const id = validated.id;
    const now = new Date().toISOString();
    const templatesDir = join(this.storePath, 'templates');
    mkdirSync(templatesDir, { recursive: true });

    // Write files
    const docxPath = join(templatesDir, docxFilename);
    const yamlFilename = `${id}.yaml`;
    const yamlPath = join(templatesDir, yamlFilename);

    writeFileSync(docxPath, docxBuffer);
    writeFileSync(yamlPath, yamlContent);

    const relDocxPath = relative(this.storePath, docxPath);
    const relYamlPath = relative(this.storePath, yamlPath);

    // Git commit both files
    const commitHash = await this.git.commitFiles(
      [relDocxPath, relYamlPath],
      `template: create ${validated.name} (${id})`,
    );

    // Insert into SQLite
    await this.db.insert(templates).values({
      id,
      name: validated.name,
      description: validated.description ?? null,
      output_format: validated.output_format,
      version: validated.version,
      template_path: relDocxPath,
      yaml_path: relYamlPath,
      author,
      created_at: now,
      updated_at: now,
      git_hash: commitHash,
    });

    // Audit log
    await this.audit.log({
      user_id: author,
      role: authorRole,
      action: 'template:create',
      fragment_id: id,
      ip_source: ip,
    });

    return { id, template_path: relDocxPath, yaml_path: relYamlPath, commit_hash: commitHash };
  }

  async list(filters?: { output_format?: string; limit?: number; offset?: number }) {
    const conditions = [];
    if (filters?.output_format) {
      conditions.push(eq(templates.output_format, filters.output_format));
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const rows = await this.db
      .select()
      .from(templates)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(desc(templates.updated_at))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async getById(id: string) {
    const rows = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const yamlPath = join(this.storePath, row.yaml_path);

    if (!existsSync(yamlPath)) {
      return { ...row, yaml: null };
    }

    const yamlContent = readFileSync(yamlPath, 'utf-8');
    const yaml = await import('js-yaml');
    const parsed = yaml.load(yamlContent);
    const validated = TemplateYamlSchema.parse(parsed);

    return { ...row, yaml: validated };
  }

  async update(
    id: string,
    docxBuffer: Buffer | undefined,
    yamlContent: string | undefined,
    author: string,
    authorRole: string,
    ip?: string,
  ) {
    const existing = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (existing.length === 0) throw new Error('Template not found');

    const row = existing[0];
    const now = new Date().toISOString();
    const filesToCommit: string[] = [];
    const updates: Partial<typeof row> = { updated_at: now };

    if (docxBuffer) {
      const docxPath = join(this.storePath, row.template_path);
      writeFileSync(docxPath, docxBuffer);
      filesToCommit.push(row.template_path);
    }

    if (yamlContent) {
      const yamlPath = join(this.storePath, row.yaml_path);
      writeFileSync(yamlPath, yamlContent);
      filesToCommit.push(row.yaml_path);

      // Re-validate and update metadata
      const yaml = await import('js-yaml');
      const parsed = yaml.load(yamlContent);
      const validated = TemplateYamlSchema.parse(parsed);
      updates.name = validated.name;
      updates.description = validated.description ?? null;
      updates.version = validated.version;
      updates.output_format = validated.output_format;
    }

    if (filesToCommit.length === 0) {
      throw new Error('No files to update');
    }

    const commitHash = await this.git.commitFiles(
      filesToCommit,
      `template: update ${row.name} (${id})`,
    );

    updates.git_hash = commitHash;

    await this.db.update(templates).set(updates).where(eq(templates.id, id));

    await this.audit.log({
      user_id: author,
      role: authorRole,
      action: 'template:update',
      fragment_id: id,
      ip_source: ip,
    });

    return { id, commit_hash: commitHash };
  }

  async delete(id: string, author: string, authorRole: string, ip?: string) {
    const existing = await this.db
      .select()
      .from(templates)
      .where(eq(templates.id, id))
      .limit(1);
    if (existing.length === 0) throw new Error('Template not found');

    const row = existing[0];

    // Git rm and commit
    const commitHash = await this.git.rmFiles(
      [row.template_path, row.yaml_path],
      `template: delete ${row.name} (${id})`,
    );

    // Delete from SQLite
    await this.db.delete(templates).where(eq(templates.id, id));

    // Audit log
    await this.audit.log({
      user_id: author,
      role: authorRole,
      action: 'template:delete',
      fragment_id: id,
      ip_source: ip,
    });

    return { id, commit_hash: commitHash };
  }
}
