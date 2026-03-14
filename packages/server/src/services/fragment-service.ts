// packages/server/src/services/fragment-service.ts
import { eq, like, and, or, desc, sql } from 'drizzle-orm';
import { join, relative } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import type { FragmintDb } from '../db/connection.js';
import { fragments } from '../db/schema.js';
import { GitRepository } from '../git/git-repository.js';
import {
  readFragment, writeFragment, generateId, deriveTitle,
} from '../git/fragment-file.js';
import { buildCommitMessage } from '../git/commit-message.js';
import {
  QUALITY_TRANSITIONS, type CreateFragmentInput, type UpdateFragmentInput,
} from '../schema/fragment.js';
import { AuditService } from './audit-service.js';
import { hasRole } from '../auth/index.js';

export class FragmentService {
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

  async create(input: CreateFragmentInput, author: string, authorRole: string, ip?: string) {
    const id = generateId();
    const now = new Date().toISOString();
    const fragmentsDir = join(this.storePath, 'fragments', input.domain);

    // Ensure domain directory exists
    const { mkdirSync } = await import('node:fs');
    mkdirSync(fragmentsDir, { recursive: true });

    const frontmatter = {
      id,
      type: input.type,
      domain: input.domain,
      tags: input.tags,
      lang: input.lang,
      translation_of: input.translation_of,
      quality: 'draft' as const,
      author,
      reviewed_by: null,
      approved_by: null,
      created_at: now,
      updated_at: now,
      valid_from: null,
      valid_until: null,
      parent_id: input.parent_id,
      generation: input.generation,
      uses: 0,
      last_used: null,
      access: input.access,
      origin: input.origin,
    };

    const filePath = writeFragment(fragmentsDir, frontmatter, input.body);
    const relPath = relative(this.storePath, filePath);

    const commitMsg = buildCommitMessage({
      action: 'create',
      type: input.type,
      domain: input.domain,
      description: `new ${input.type} fragment`,
      author,
      fragmentId: id,
      qualityTransition: 'draft',
    });

    const commitHash = await this.git.commit(relPath, commitMsg);

    // Index in SQLite
    const title = deriveTitle(input.body);
    await this.db.insert(fragments).values({
      id, type: input.type, domain: input.domain, lang: input.lang,
      quality: 'draft', author, title,
      body_excerpt: input.body.slice(0, 200),
      created_at: now, updated_at: now,
      file_path: relPath, git_hash: commitHash,
      origin: input.origin,
      parent_id: input.parent_id ?? null,
      translation_of: input.translation_of ?? null,
    });

    await this.audit.log({
      user_id: author, role: authorRole, action: 'create',
      fragment_id: id, ip_source: ip,
    });

    return { id, file_path: relPath, commit_hash: commitHash, quality: 'draft' };
  }

  async getById(id: string) {
    const rows = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const filePath = join(this.storePath, row.file_path);
    const { frontmatter, body } = readFragment(filePath);

    return { ...row, frontmatter, body };
  }

  async list(filters?: {
    type?: string;
    domain?: string;
    lang?: string;
    quality?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions = [];
    if (filters?.type) conditions.push(eq(fragments.type, filters.type));
    if (filters?.domain) conditions.push(eq(fragments.domain, filters.domain));
    if (filters?.lang) conditions.push(eq(fragments.lang, filters.lang));
    if (filters?.quality) conditions.push(eq(fragments.quality, filters.quality));

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;

    const rows = await this.db.select().from(fragments)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(fragments.updated_at))
      .limit(limit)
      .offset(offset);

    return rows;
  }

  async search(query: string, filters?: {
    type?: string[];
    domain?: string[];
    lang?: string;
    quality_min?: string;
  }, limit = 20) {
    const conditions = [];
    const q = `%${query}%`;
    conditions.push(or(like(fragments.title, q), like(fragments.body_excerpt, q)));

    if (filters?.type?.length) {
      conditions.push(sql`${fragments.type} IN (${sql.join(filters.type.map(t => sql`${t}`), sql`, `)})`);
    }
    if (filters?.lang) conditions.push(eq(fragments.lang, filters.lang));

    const rows = await this.db.select().from(fragments)
      .where(and(...conditions))
      .orderBy(desc(fragments.uses))
      .limit(limit);

    return rows;
  }

  async update(id: string, input: UpdateFragmentInput, userId: string, userRole: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');

    // Check write permission
    if (existing.quality === 'approved' && !hasRole(userRole, 'expert')) {
      throw new Error('Only expert+ can modify approved fragments');
    }

    // Quality transition validation
    if (input.quality && input.quality !== existing.quality) {
      const allowed = QUALITY_TRANSITIONS[existing.quality] || [];
      if (!allowed.includes(input.quality)) {
        throw new Error(`Transition ${existing.quality} → ${input.quality} not allowed`);
      }
      if (input.quality === 'approved') {
        throw new Error('Use the approve endpoint for reviewed → approved');
      }
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    const updatedFrontmatter = { ...frontmatter };
    const newBody = input.body ?? body;

    if (input.tags) updatedFrontmatter.tags = input.tags;
    if (input.domain) updatedFrontmatter.domain = input.domain;
    if (input.quality) {
      updatedFrontmatter.quality = input.quality;
      if (input.quality === 'reviewed') updatedFrontmatter.reviewed_by = userId;
    }
    if (input.access) updatedFrontmatter.access = input.access;
    updatedFrontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', updatedFrontmatter.domain), updatedFrontmatter, newBody);

    const commitMsg = buildCommitMessage({
      action: 'update', type: updatedFrontmatter.type,
      domain: updatedFrontmatter.domain,
      description: 'updated fragment',
      author: userId, fragmentId: id,
      qualityTransition: input.quality ? `${existing.quality} → ${input.quality}` : undefined,
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      domain: updatedFrontmatter.domain,
      quality: updatedFrontmatter.quality,
      updated_at: updatedFrontmatter.updated_at,
      title: deriveTitle(newBody),
      body_excerpt: newBody.slice(0, 200),
      git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: userRole, action: 'update',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash };
  }

  async approve(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    if (existing.quality !== 'reviewed') {
      throw new Error(`Cannot approve: current quality is '${existing.quality}', must be 'reviewed'`);
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    frontmatter.quality = 'approved';
    frontmatter.approved_by = userId;
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', frontmatter.domain), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'approve', type: frontmatter.type,
      domain: frontmatter.domain,
      description: `approved by ${userId}`,
      author: userId, fragmentId: id,
      qualityTransition: 'reviewed → approved',
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      quality: 'approved', updated_at: frontmatter.updated_at, git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: 'expert', action: 'approve',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash, quality: 'approved' };
  }

  async deprecate(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    const allowed = QUALITY_TRANSITIONS[existing.quality] || [];
    if (!allowed.includes('deprecated')) {
      throw new Error(`Cannot deprecate: current quality '${existing.quality}' does not allow transition to deprecated`);
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    const oldQuality = frontmatter.quality;
    frontmatter.quality = 'deprecated';
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(join(this.storePath, 'fragments', frontmatter.domain), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'deprecate', type: frontmatter.type,
      domain: frontmatter.domain,
      description: `deprecated by ${userId}`,
      author: userId, fragmentId: id,
      qualityTransition: `${oldQuality} → deprecated`,
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db.update(fragments).set({
      quality: 'deprecated', updated_at: frontmatter.updated_at, git_hash: commitHash,
    }).where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId, role: 'admin', action: 'deprecate',
      fragment_id: id, ip_source: ip,
    });

    return { id, commit_hash: commitHash, quality: 'deprecated' };
  }

  async history(id: string) {
    const rows = await this.db.select({ file_path: fragments.file_path })
      .from(fragments).where(eq(fragments.id, id)).limit(1);
    if (rows.length === 0) throw new Error('Fragment not found');
    return this.git.log(rows[0].file_path);
  }

  async inventory(topic?: string, lang?: string) {
    const allFragments = await this.db.select({
      type: fragments.type,
      domain: fragments.domain,
      lang: fragments.lang,
      quality: fragments.quality,
    }).from(fragments);

    const filtered = topic
      ? allFragments.filter(f => f.domain.toLowerCase().includes(topic.toLowerCase()))
      : allFragments;

    const byType: Record<string, number> = {};
    const byQuality: Record<string, number> = {};
    const byLang: Record<string, Record<string, number>> = {};

    for (const f of filtered) {
      byType[f.type] = (byType[f.type] || 0) + 1;
      byQuality[f.quality] = (byQuality[f.quality] || 0) + 1;

      if (!byLang[f.lang]) byLang[f.lang] = {};
      byLang[f.lang][f.quality] = (byLang[f.lang][f.quality] || 0) + 1;
    }

    return {
      total: filtered.length,
      by_type: byType,
      by_quality: byQuality,
      by_lang: byLang,
    };
  }

  async lineage(id: string) {
    const row = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (row.length === 0) throw new Error('Fragment not found');
    const frag = row[0];

    const children = await this.db.select().from(fragments)
      .where(eq(fragments.parent_id, id));
    const translations = await this.db.select().from(fragments)
      .where(eq(fragments.translation_of, id));

    return { root: frag, children, translations };
  }

  async reindex() {
    const fragmentsDir = join(this.storePath, 'fragments');
    const files = this.walkDir(fragmentsDir).filter(f => f.endsWith('.md'));
    let indexed = 0;

    for (const absPath of files) {
      try {
        const { frontmatter, body } = readFragment(absPath);
        const relPath = relative(this.storePath, absPath);
        const title = deriveTitle(body);

        await this.db.insert(fragments).values({
          id: frontmatter.id,
          type: frontmatter.type,
          domain: frontmatter.domain,
          lang: frontmatter.lang,
          quality: frontmatter.quality,
          author: frontmatter.author,
          title,
          body_excerpt: body.slice(0, 200),
          created_at: frontmatter.created_at,
          updated_at: frontmatter.updated_at,
          file_path: relPath,
          origin: frontmatter.origin ?? 'manual',
          parent_id: frontmatter.parent_id ?? null,
          translation_of: frontmatter.translation_of ?? null,
        }).onConflictDoUpdate({
          target: fragments.id,
          set: {
            quality: frontmatter.quality,
            updated_at: frontmatter.updated_at,
            title,
            body_excerpt: body.slice(0, 200),
            file_path: relPath,
          },
        });
        indexed++;
      } catch (err) {
        console.error(`Failed to index ${absPath}:`, err);
      }
    }

    return { indexed, total: files.length };
  }

  private walkDir(dir: string): string[] {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      return entries.flatMap(e =>
        e.isDirectory() ? this.walkDir(join(dir, e.name)) : [join(dir, e.name)]
      );
    } catch {
      return [];
    }
  }
}
