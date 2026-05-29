// packages/server/src/services/fragment-service.ts
import { eq, and, or, desc, like, isNull, lte, gte, count, inArray, ne } from 'drizzle-orm';
import { join, relative } from 'node:path';
import { readdirSync, unlinkSync } from 'node:fs';
import type { FragmintDb } from '../db/connection.js';
import {
  fragments,
  collections,
  fragmentDomains,
  fragmentTags,
  fragmentEntities,
  entities as entitiesTable,
  fragmentTagLinks,
  harvestCandidates,
} from '../db/schema.js';
import { GitRepository } from '../git/git-repository.js';
import { readFragment, writeFragment, generateId, deriveTitle } from '../git/fragment-file.js';
import type { FragmentMetadata } from '../search/search-service.js';
import { buildCommitMessage } from '../git/commit-message.js';
import {
  QUALITY_TRANSITIONS,
  type CreateFragmentInput,
  type UpdateFragmentInput,
} from '../schema/fragment.js';
import { AuditService } from './audit-service.js';
import { hasRole } from '../auth/index.js';
import { generateReadableId } from './readable-id.js';
import { SearchService, type SearchFilters } from '../search/index.js';
import type { LlmClient } from './llm-client.js';
import { detectAndPropose } from './supersedure-detector.js';

export class FragmentService {
  protected git: GitRepository;
  llmClient?: LlmClient;
  indexService?: { invalidateCache(): void };

  constructor(
    protected db: FragmintDb,
    protected storePath: string,
    protected audit: AuditService,
    protected searchService: SearchService,
  ) {
    this.git = new GitRepository(storePath);
  }

  getGit(): GitRepository {
    return this.git;
  }

  /**
   * Compute the fragments directory for a collection.
   * Domain is NOT used as a subdirectory — it's already baked into the filename.
   * common (or null) → <root>/fragments/
   * named collection  → <root>/fragments/<slug>/
   */
  protected fragmentsDir(collectionSlug: string | null | undefined): string {
    if (!collectionSlug || collectionSlug === 'common') {
      return join(this.storePath, 'fragments');
    }
    return join(this.storePath, 'fragments', collectionSlug);
  }

  async create(
    input: CreateFragmentInput,
    author: string,
    authorRole: string,
    ip?: string,
    storePathOverride?: string,
    collectionSlug?: string,
  ) {
    const id = generateId();
    // Generate with retry — protects against the read-then-write race under concurrent requests
    let readableId: string | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = await generateReadableId(this.db, input.domain, input.type);
      const collision = await this.db
        .select({ id: fragments.id })
        .from(fragments)
        .where(eq(fragments.readable_id, candidate))
        .limit(1);
      if (collision.length === 0) { readableId = candidate; break; }
    }
    if (!readableId) readableId = await generateReadableId(this.db, input.domain, input.type);
    const now = new Date().toISOString();
    const effectivePath = storePathOverride ?? this.storePath;
    const fragmentsDir = storePathOverride
      ? join(storePathOverride, 'fragments')
      : this.fragmentsDir(collectionSlug);

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
      valid_from: input.valid_from ?? null,
      valid_until: input.valid_until ?? null,
      parent_id: input.parent_id,
      generation: input.generation,
      uses: 0,
      last_used: null,
      access: input.access,
      origin: input.origin,
      origin_source: input.origin_source ?? null,
      origin_page: input.origin_page ?? null,
      function_type: input.function_type ?? null,
      audience: input.audience ?? [],
      maturity: input.maturity ?? null,
    };

    const filePath = writeFragment(fragmentsDir, frontmatter, input.body);
    const relPath = relative(effectivePath, filePath);

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
      id,
      type: input.type,
      domain: input.domain,
      lang: input.lang,
      quality: 'draft',
      author,
      title,
      body_excerpt: input.body.slice(0, 200),
      created_at: now,
      updated_at: now,
      file_path: relPath,
      git_hash: commitHash,
      collection_slug: collectionSlug ?? 'common',
      origin: input.origin,
      origin_source: input.origin_source ?? null,
      origin_page: input.origin_page ?? null,
      parent_id: input.parent_id ?? null,
      translation_of: input.translation_of ?? null,
      tags: input.tags && input.tags.length > 0 ? JSON.stringify(input.tags) : null,
      valid_from: input.valid_from ?? null,
      valid_until: input.valid_until ?? null,
      function_type: input.function_type ?? null,
      audience: input.audience ? JSON.stringify(input.audience) : null,
      maturity: input.maturity ?? null,
      harvest_confidence: (input as any).harvest_confidence ?? null,
      readable_id: readableId,
    });

    // Sync fragment_tag_links
    if (input.tags && input.tags.length > 0) {
      await this.db
        .insert(fragmentTagLinks)
        .values(input.tags.map((slug) => ({ fragment_id: id, tag_slug: slug })))
        .onConflictDoNothing();
    }

    await this.audit.log({
      user_id: author,
      role: authorRole,
      action: 'create',
      fragment_id: id,
      ip_source: ip,
    });

    // Index in vector store
    await this.searchService.indexFragment(id, input.body, {
      type: input.type,
      domain: input.domain,
      lang: input.lang,
      quality: 'draft',
      author,
      tags: input.tags,
      access_read: input.access.read,
      created_at: now,
      updated_at: now,
      function_type: input.function_type ?? null,
      audience: input.audience ?? [],
      maturity: input.maturity ?? null,
    });

    return { id, readable_id: readableId, file_path: relPath, commit_hash: commitHash, quality: 'draft' };
  }

  async getById(id: string) {
    const rows = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (rows.length === 0) return null;

    const row = rows[0];
    const filePath = join(this.storePath, row.file_path);

    const entityRows = await this.db
      .select({
        id: entitiesTable.id,
        canonicalName: entitiesTable.canonicalName,
        type: entitiesTable.type,
      })
      .from(fragmentEntities)
      .innerJoin(entitiesTable, eq(entitiesTable.id, fragmentEntities.entity_id))
      .where(eq(fragmentEntities.fragment_id, id));

    // If the fragment came from harvest, surface near-dup detection info for the validation UI
    let harvest_near_dup: {
      fragment_id: string;
      score: number | null;
      method: string | null;
    } | null = null;
    if (row.origin === 'harvested') {
      const dupRows = await this.db
        .select({
          duplicate_of: harvestCandidates.duplicate_of,
          duplicate_score: harvestCandidates.duplicate_score,
          duplicate_method: harvestCandidates.duplicate_method,
        })
        .from(harvestCandidates)
        .where(
          and(
            eq(harvestCandidates.fragment_id, id),
            // only when a near-dup was actually detected
          ),
        )
        .limit(1);
      const dup = dupRows[0];
      if (dup?.duplicate_of) {
        harvest_near_dup = {
          fragment_id: dup.duplicate_of,
          score: dup.duplicate_score,
          method: dup.duplicate_method,
        };
      }
    }

    try {
      const { frontmatter, body } = readFragment(filePath);
      return { ...row, frontmatter, body, entities: entityRows, harvest_near_dup };
    } catch (e: any) {
      if (e?.code === 'ENOENT') return null; // fichier manquant → 404 propre
      throw e;
    }
  }

  async getByReadableId(readableId: string) {
    const rows = await this.db
      .select()
      .from(fragments)
      .where(eq(fragments.readable_id, readableId))
      .limit(1);
    if (rows.length === 0) return null;
    return this.getById(rows[0].id);
  }

  /** Replace the full set of entity links for a fragment. Only links to validated entities. */
  async updateEntities(fragmentId: string, entityIds: number[]): Promise<void> {
    // Verify all requested IDs are validated entities
    const valid =
      entityIds.length > 0
        ? await this.db
            .select({ id: entitiesTable.id })
            .from(entitiesTable)
            .where(and(inArray(entitiesTable.id, entityIds), eq(entitiesTable.validated, 1)))
        : [];
    const validIds = valid.map((r) => r.id);

    await this.db.delete(fragmentEntities).where(eq(fragmentEntities.fragment_id, fragmentId));
    if (validIds.length > 0) {
      await this.db
        .insert(fragmentEntities)
        .values(validIds.map((entity_id) => ({ fragment_id: fragmentId, entity_id })))
        .onConflictDoNothing();
    }
  }

  async list(filters?: {
    type?: string;
    domain?: string;
    lang?: string;
    quality?: string;
    limit?: number;
    offset?: number;
    filePathPrefix?: string;
    collectionSlug?: string;
    valid_at?: string;
    function_type?: string[];
    audience?: string[];
    maturity?: string[];
  }) {
    const conditions = [];
    if (filters?.type) conditions.push(eq(fragments.type, filters.type));
    if (filters?.domain) conditions.push(eq(fragments.domain, filters.domain));
    if (filters?.lang) conditions.push(eq(fragments.lang, filters.lang));
    if (filters?.quality) conditions.push(eq(fragments.quality, filters.quality));
    if (filters?.function_type?.length) {
      conditions.push(inArray(fragments.function_type, filters.function_type));
    }
    if (filters?.audience?.length) {
      conditions.push(or(...filters.audience.map((aud) => like(fragments.audience, `%"${aud}"%`))));
    }
    if (filters?.maturity?.length) {
      conditions.push(inArray(fragments.maturity, filters.maturity));
    }
    if (filters?.collectionSlug) {
      if (filters.collectionSlug === 'common') {
        // Match both collection_slug='common' and NULL (legacy fragments)
        conditions.push(
          or(eq(fragments.collection_slug, 'common'), isNull(fragments.collection_slug)),
        );
      } else {
        conditions.push(eq(fragments.collection_slug, filters.collectionSlug));
      }
    } else if (filters?.filePathPrefix) {
      conditions.push(like(fragments.file_path, `${filters.filePathPrefix}%`));
    }

    if (filters?.valid_at) {
      conditions.push(
        or(isNull(fragments.valid_from), lte(fragments.valid_from, filters.valid_at)),
      );
      conditions.push(
        or(isNull(fragments.valid_until), gte(fragments.valid_until, filters.valid_at)),
      );
    }

    const limit = filters?.limit ?? 50;
    const offset = filters?.offset ?? 0;
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(fragments)
        .where(where)
        .orderBy(desc(fragments.updated_at))
        .limit(limit)
        .offset(offset),
      this.db.select({ total: count() }).from(fragments).where(where),
    ]);

    // Batch-enrich harvest_near_dup for harvested fragments (single extra query per page)
    const harvestedIds = rows.filter((r) => r.origin === 'harvested').map((r) => r.id);
    const nearDupMap = new Map<
      string,
      { fragment_id: string; score: number | null; method: string | null }
    >();
    if (harvestedIds.length > 0) {
      const dupRows = await this.db
        .select({
          frag_id: harvestCandidates.fragment_id,
          duplicate_of: harvestCandidates.duplicate_of,
          duplicate_score: harvestCandidates.duplicate_score,
          duplicate_method: harvestCandidates.duplicate_method,
        })
        .from(harvestCandidates)
        .where(inArray(harvestCandidates.fragment_id, harvestedIds));
      for (const d of dupRows) {
        if (d.frag_id && d.duplicate_of) {
          nearDupMap.set(d.frag_id, {
            fragment_id: d.duplicate_of,
            score: d.duplicate_score,
            method: d.duplicate_method,
          });
        }
      }
    }

    const enrichedRows = rows.map((r) => ({
      ...r,
      harvest_near_dup: nearDupMap.get(r.id) ?? null,
    }));

    return { rows: enrichedRows, total };
  }

  async search(query: string, filters?: SearchFilters, limit = 20, partitionNames?: string[]) {
    return this.searchService.search(query, filters, limit, partitionNames);
  }

  async update(
    id: string,
    input: UpdateFragmentInput,
    userId: string,
    userRole: string,
    ip?: string,
  ) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');

    // Check write permission
    const isContentEdit = !!(
      input.body !== undefined ||
      input.tags !== undefined ||
      input.domain !== undefined ||
      input.type !== undefined ||
      input.lang !== undefined
    );
    if (
      isContentEdit &&
      (existing.quality === 'approved' || existing.quality === 'reviewed') &&
      !hasRole(userRole, 'expert')
    ) {
      throw new Error('Only expert+ can modify reviewed or approved fragments');
    }
    if (
      isContentEdit &&
      existing.quality === 'draft' &&
      existing.author !== userId &&
      !hasRole(userRole, 'expert')
    ) {
      throw new Error('Only the author or expert+ can modify a draft fragment');
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
    if (input.type) updatedFrontmatter.type = input.type;
    if (input.domain) updatedFrontmatter.domain = input.domain;
    if (input.lang) updatedFrontmatter.lang = input.lang;
    if (input.quality) {
      updatedFrontmatter.quality = input.quality;
      if (input.quality === 'reviewed') updatedFrontmatter.reviewed_by = userId;
    }
    if (input.access) updatedFrontmatter.access = input.access;
    if (input.function_type !== undefined) updatedFrontmatter.function_type = input.function_type;
    if (input.audience !== undefined) updatedFrontmatter.audience = input.audience;
    if (input.maturity !== undefined) updatedFrontmatter.maturity = input.maturity;
    updatedFrontmatter.updated_at = new Date().toISOString();

    const newAbsPath = writeFragment(
      this.fragmentsDir(existing.collection_slug),
      updatedFrontmatter,
      newBody,
    );
    const newRelPath = relative(this.storePath, newAbsPath);

    const commitMsg = buildCommitMessage({
      action: 'update',
      type: updatedFrontmatter.type,
      domain: updatedFrontmatter.domain,
      description: 'updated fragment',
      author: userId,
      fragmentId: id,
      qualityTransition: input.quality ? `${existing.quality} → ${input.quality}` : undefined,
    });

    let commitHash: string;
    if (newRelPath !== existing.file_path) {
      try {
        unlinkSync(join(this.storePath, existing.file_path));
      } catch {
        /* already gone */
      }
      commitHash = await this.git.commitMove(commitMsg);
    } else {
      commitHash = await this.git.commit(existing.file_path, commitMsg);
    }

    await this.db
      .update(fragments)
      .set({
        type: updatedFrontmatter.type,
        domain: updatedFrontmatter.domain,
        lang: updatedFrontmatter.lang,
        quality: updatedFrontmatter.quality,
        tags: JSON.stringify(updatedFrontmatter.tags ?? []),
        updated_at: updatedFrontmatter.updated_at,
        title: deriveTitle(newBody),
        body_excerpt: newBody.slice(0, 200),
        git_hash: commitHash,
        file_path: newRelPath,
        function_type: updatedFrontmatter.function_type ?? null,
        audience: updatedFrontmatter.audience ? JSON.stringify(updatedFrontmatter.audience) : null,
        maturity: updatedFrontmatter.maturity ?? null,
      })
      .where(eq(fragments.id, id));

    // Sync fragment_tag_links: delete stale, insert current
    await this.db.delete(fragmentTagLinks).where(eq(fragmentTagLinks.fragment_id, id));
    const newTags = updatedFrontmatter.tags ?? [];
    if (newTags.length > 0) {
      await this.db
        .insert(fragmentTagLinks)
        .values(newTags.map((slug) => ({ fragment_id: id, tag_slug: slug })))
        .onConflictDoNothing();
    }

    // Propagate human-direct trust to referential for any manually edited fields
    const now = new Date().toISOString();
    if (input.domain) {
      await this.db
        .insert(fragmentDomains)
        .values({
          slug: input.domain,
          label: input.domain,
          created_at: now,
          validated: 1,
          proposedBy: userId,
          trustSource: 'human-direct',
        })
        .onConflictDoUpdate({
          target: fragmentDomains.slug,
          set: { trustSource: 'human-direct', validated: 1 },
        });
    }
    if (input.tags && input.tags.length > 0) {
      for (const tag of input.tags) {
        await this.db
          .insert(fragmentTags)
          .values({
            slug: tag,
            label: tag,
            created_at: now,
            validated: 1,
            proposedBy: userId,
            trustSource: 'human-direct',
          })
          .onConflictDoUpdate({
            target: fragmentTags.slug,
            set: { trustSource: 'human-direct', validated: 1 },
          });
      }
    }

    await this.audit.log({
      user_id: userId,
      role: userRole,
      action: 'update',
      fragment_id: id,
      ip_source: ip,
    });

    // Re-index in vector store
    await this.searchService.indexFragment(id, newBody, {
      type: updatedFrontmatter.type,
      domain: updatedFrontmatter.domain,
      lang: updatedFrontmatter.lang,
      quality: updatedFrontmatter.quality,
      author: updatedFrontmatter.author,
      tags: updatedFrontmatter.tags,
      access_read: updatedFrontmatter.access.read,
      created_at: updatedFrontmatter.created_at,
      updated_at: updatedFrontmatter.updated_at,
      function_type: updatedFrontmatter.function_type ?? null,
      audience: updatedFrontmatter.audience ?? [],
      maturity: updatedFrontmatter.maturity ?? null,
    });

    if (input.quality === 'reviewed' && this.llmClient) {
      detectAndPropose(id, this.db, this.llmClient).catch(() => {});
    }
    this.indexService?.invalidateCache();

    return { id, commit_hash: commitHash };
  }

  async approve(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    if (existing.quality !== 'reviewed') {
      throw new Error(
        `Cannot approve: current quality is '${existing.quality}', must be 'reviewed'`,
      );
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    frontmatter.quality = 'approved';
    frontmatter.approved_by = userId;
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(this.fragmentsDir(existing.collection_slug), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'approve',
      type: frontmatter.type,
      domain: frontmatter.domain,
      description: `approved by ${userId}`,
      author: userId,
      fragmentId: id,
      qualityTransition: 'reviewed → approved',
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db
      .update(fragments)
      .set({
        quality: 'approved',
        updated_at: frontmatter.updated_at,
        git_hash: commitHash,
      })
      .where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId,
      role: 'expert',
      action: 'approve',
      fragment_id: id,
      ip_source: ip,
    });

    // Re-index in vector store with updated quality
    await this.searchService.indexFragment(id, body, {
      type: frontmatter.type,
      domain: frontmatter.domain,
      lang: frontmatter.lang,
      quality: 'approved',
      author: frontmatter.author,
      tags: frontmatter.tags,
      access_read: frontmatter.access.read,
      created_at: frontmatter.created_at,
      updated_at: frontmatter.updated_at,
      function_type: frontmatter.function_type ?? null,
      audience: frontmatter.audience ?? [],
      maturity: frontmatter.maturity ?? null,
    });
    this.indexService?.invalidateCache();

    return { id, commit_hash: commitHash, quality: 'approved' };
  }

  async deprecate(id: string, userId: string, ip?: string) {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Fragment not found');
    const allowed = QUALITY_TRANSITIONS[existing.quality] || [];
    if (!allowed.includes('deprecated')) {
      throw new Error(
        `Cannot deprecate: current quality '${existing.quality}' does not allow transition to deprecated`,
      );
    }

    const filePath = join(this.storePath, existing.file_path);
    const { frontmatter, body } = readFragment(filePath);

    const oldQuality = frontmatter.quality;
    frontmatter.quality = 'deprecated';
    frontmatter.updated_at = new Date().toISOString();

    writeFragment(this.fragmentsDir(existing.collection_slug), frontmatter, body);

    const commitMsg = buildCommitMessage({
      action: 'deprecate',
      type: frontmatter.type,
      domain: frontmatter.domain,
      description: `deprecated by ${userId}`,
      author: userId,
      fragmentId: id,
      qualityTransition: `${oldQuality} → deprecated`,
    });

    const commitHash = await this.git.commit(existing.file_path, commitMsg);

    await this.db
      .update(fragments)
      .set({
        quality: 'deprecated',
        updated_at: frontmatter.updated_at,
        git_hash: commitHash,
      })
      .where(eq(fragments.id, id));

    await this.audit.log({
      user_id: userId,
      role: 'admin',
      action: 'deprecate',
      fragment_id: id,
      ip_source: ip,
    });

    await this.searchService.removeFromIndex(id);
    this.indexService?.invalidateCache();

    return { id, commit_hash: commitHash, quality: 'deprecated' };
  }

  async delete(id: string, userId: string, ip?: string) {
    const [row] = await this.db
      .select({
        file_path: fragments.file_path,
        collection_slug: fragments.collection_slug,
        type: fragments.type,
        domain: fragments.domain,
      })
      .from(fragments)
      .where(eq(fragments.id, id))
      .limit(1);

    if (!row) throw new Error(`Fragment not found (id=${id})`);

    const commitMsg = buildCommitMessage({
      action: 'delete',
      type: row.type,
      domain: row.domain,
      description: `deleted by ${userId}`,
      author: userId,
      fragmentId: id,
    });

    try {
      await this.git.rmFiles([row.file_path], commitMsg);
    } catch (e) {
      console.warn(`[delete] git rm failed for ${row.file_path}, forcing DB delete:`, e);
    }
    await this.db.delete(fragmentTagLinks).where(eq(fragmentTagLinks.fragment_id, id));
    await this.db.delete(fragments).where(eq(fragments.id, id));
    await this.searchService.removeFromIndex(id);
    this.indexService?.invalidateCache();
    await this.audit.log({
      user_id: userId,
      role: 'admin',
      action: 'delete',
      fragment_id: id,
      ip_source: ip,
    });

    return { id, deleted: true };
  }

  async history(id: string) {
    const rows = await this.db
      .select({ file_path: fragments.file_path, collection_slug: fragments.collection_slug })
      .from(fragments)
      .where(eq(fragments.id, id))
      .limit(1);
    if (rows.length === 0) throw new Error('Fragment not found');
    return this.git.log(rows[0].file_path);
  }

  async filterOwnedIds(ids: string[], authorLogin: string): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.db
      .select({ id: fragments.id })
      .from(fragments)
      .where(
        and(
          inArray(fragments.id, ids),
          eq(fragments.author, authorLogin),
          ne(fragments.quality, 'approved'),
        ),
      );
    return rows.map((r) => r.id);
  }

  async facets(collectionSlug?: string) {
    const condition = collectionSlug
      ? collectionSlug === 'common'
        ? or(eq(fragments.collection_slug, 'common'), isNull(fragments.collection_slug))
        : eq(fragments.collection_slug, collectionSlug)
      : undefined;

    const rows = await this.db
      .select({ domain: fragments.domain, tags: fragments.tags })
      .from(fragments)
      .where(condition);

    const domains = [...new Set(rows.map((r) => r.domain).filter(Boolean))].sort();
    const tagSet = new Set<string>();
    for (const row of rows) {
      if (row.tags) {
        try {
          const parsed = JSON.parse(row.tags) as string[];
          for (const t of parsed) tagSet.add(t);
        } catch {
          /* skip malformed */
        }
      }
    }
    return { domains, tags: [...tagSet].sort() };
  }

  async inventory(topic?: string, lang?: string) {
    const allFragments = await this.db
      .select({
        id: fragments.id,
        type: fragments.type,
        domain: fragments.domain,
        lang: fragments.lang,
        quality: fragments.quality,
        translation_of: fragments.translation_of,
      })
      .from(fragments);

    const filtered = topic
      ? allFragments.filter((f) => f.domain.toLowerCase().includes(topic.toLowerCase()))
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

    // Gap detection
    const gaps: Array<{
      type: string;
      domain: string;
      lang: string;
      status: 'no_approved' | 'missing_translation';
      draft_count?: number;
      source_id?: string;
    }> = [];

    // 1. Find type/domain pairs with no approved fragment
    const typeDomainPairs = new Map<string, { drafts: number; hasApproved: boolean }>();
    for (const f of filtered) {
      const key = `${f.type}|${f.domain}`;
      const entry = typeDomainPairs.get(key) ?? { drafts: 0, hasApproved: false };
      if (f.quality === 'approved') entry.hasApproved = true;
      if (f.quality === 'draft') entry.drafts++;
      typeDomainPairs.set(key, entry);
    }
    for (const [key, val] of typeDomainPairs) {
      if (!val.hasApproved) {
        const [type, domain] = key.split('|');
        gaps.push({ type, domain, lang: '*', status: 'no_approved', draft_count: val.drafts });
      }
    }

    // 2. Find fragments with missing translations
    const allLangs = [...new Set(allFragments.map((f) => f.lang))];
    const originals = allFragments.filter((f) => !f.translation_of);
    for (const orig of originals) {
      const translations = allFragments.filter((f) => f.translation_of === orig.id);
      const translatedLangs = new Set([orig.lang, ...translations.map((t) => t.lang)]);
      for (const l of allLangs) {
        if (!translatedLangs.has(l)) {
          gaps.push({
            type: orig.type,
            domain: orig.domain,
            lang: l,
            status: 'missing_translation',
            source_id: orig.id,
          });
        }
      }
    }

    return {
      total: filtered.length,
      by_type: byType,
      by_quality: byQuality,
      by_lang: byLang,
      gaps,
    };
  }

  async lineage(id: string) {
    const row = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
    if (row.length === 0) throw new Error('Fragment not found');
    const frag = row[0];

    const children = await this.db.select().from(fragments).where(eq(fragments.parent_id, id));
    const translations = await this.db
      .select()
      .from(fragments)
      .where(eq(fragments.translation_of, id));

    return { root: frag, children, translations };
  }

  async reindex() {
    // Single vault: all collections live under fragments/<slug>/ in the root git.
    const customCollections = await this.db.select({ slug: collections.slug }).from(collections);
    const collectionSlugs = new Set(
      customCollections.map((c) => c.slug).filter((s) => s !== 'common'),
    );
    const vaults: Array<{ storePath: string; collectionSlug: string; fragmentsSubdir: string }> = [
      { storePath: this.storePath, collectionSlug: 'common', fragmentsSubdir: 'fragments' },
      ...[...collectionSlugs].map((slug) => ({
        storePath: this.storePath,
        collectionSlug: slug,
        fragmentsSubdir: `fragments/${slug}`,
      })),
    ];

    let indexed = 0;
    let totalFiles = 0;
    const batchItems: Array<{ id: string; body: string; metadata: FragmentMetadata }> = [];

    for (const { storePath, collectionSlug, fragmentsSubdir } of vaults) {
      const fragmentsDir = join(storePath, fragmentsSubdir);
      const files = this.walkDir(fragmentsDir).filter((f) => f.endsWith('.md'));

      for (const absPath of files) {
        totalFiles++;
        try {
          const { frontmatter, body } = readFragment(absPath);
          const relPath = relative(storePath, absPath);
          const title = deriveTitle(body);

          // Generate readable_id for new fragments (existing ones keep theirs — readable_id is
          // intentionally excluded from onConflictDoUpdate.set so it's never overwritten)
          const reindexReadableId = await generateReadableId(
            this.db,
            frontmatter.domain,
            frontmatter.type,
          );

          await this.db
            .insert(fragments)
            .values({
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
              collection_slug: collectionSlug,
              origin: frontmatter.origin ?? 'manual',
              parent_id: frontmatter.parent_id ?? null,
              translation_of: frontmatter.translation_of ?? null,
              valid_from: frontmatter.valid_from ?? null,
              valid_until: frontmatter.valid_until ?? null,
              readable_id: reindexReadableId,
            })
            .onConflictDoUpdate({
              target: fragments.id,
              set: {
                quality: frontmatter.quality,
                updated_at: frontmatter.updated_at,
                title,
                body_excerpt: body.slice(0, 200),
                file_path: relPath,
                collection_slug: collectionSlug,
                valid_from: frontmatter.valid_from ?? null,
                valid_until: frontmatter.valid_until ?? null,
                // readable_id intentionally omitted: existing fragments keep their stable ID
              },
            });

          // Sync fragment_tag_links for reindexed fragment
          const reindexTags: string[] = frontmatter.tags ?? [];
          await this.db
            .delete(fragmentTagLinks)
            .where(eq(fragmentTagLinks.fragment_id, frontmatter.id));
          if (reindexTags.length > 0) {
            await this.db
              .insert(fragmentTagLinks)
              .values(reindexTags.map((slug) => ({ fragment_id: frontmatter.id, tag_slug: slug })))
              .onConflictDoNothing();
          }

          batchItems.push({
            id: frontmatter.id,
            body,
            metadata: {
              type: frontmatter.type,
              domain: frontmatter.domain,
              lang: frontmatter.lang,
              quality: frontmatter.quality,
              author: frontmatter.author,
              tags: frontmatter.tags,
              access_read: frontmatter.access?.read ?? ['*'],
              created_at: frontmatter.created_at,
              updated_at: frontmatter.updated_at,
              function_type: frontmatter.function_type ?? null,
              audience: frontmatter.audience ?? [],
              maturity: frontmatter.maturity ?? null,
            },
          });
          indexed++;
        } catch (err) {
          console.error(`Failed to index ${absPath}:`, err);
        }
      }
    }

    // Batch index into vector store
    if (batchItems.length > 0) {
      const vectorResult = await this.searchService.indexBatch(batchItems);
      console.log(`Vector-indexed ${vectorResult.indexed} fragments`);
    }

    return { indexed, total: totalFiles };
  }

  private walkDir(dir: string): string[] {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      return entries.flatMap((e) =>
        e.isDirectory() ? this.walkDir(join(dir, e.name)) : [join(dir, e.name)],
      );
    } catch {
      return [];
    }
  }
}
