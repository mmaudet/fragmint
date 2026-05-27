// packages/server/src/services/fragment-bulk-service.ts
import { eq, inArray } from 'drizzle-orm';
import { join, relative, dirname } from 'node:path';
import { fragments } from '../db/schema.js';
import { readFragment, writeFragment, generateId, deriveTitle } from '../git/fragment-file.js';
import { detectAndPropose } from './supersedure-detector.js';
import { FragmentService } from './fragment-service.js';

export class FragmentBulkService extends FragmentService {
  async bulkReview(
    ids: string[],
    userId: string,
    ip: string | undefined,
    onProgress?: (done: number) => void,
  ): Promise<{ done: number; errors: number }> {
    const now = new Date().toISOString();
    type Group = { filePaths: string[]; ids: string[] };
    const groups = new Map<string, Group>();
    const indexData = new Map<string, { body: string; frontmatter: any }>();
    let errors = 0;

    for (const id of ids) {
      try {
        const [frag] = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
        if (!frag || frag.quality !== 'draft') continue;
        const existingAbsPath = join(this.storePath, frag.file_path);
        const { frontmatter, body } = readFragment(existingAbsPath);
        frontmatter.quality = 'reviewed';
        frontmatter.reviewed_by = userId;
        frontmatter.updated_at = now;
        writeFragment(dirname(existingAbsPath), frontmatter, body);
        indexData.set(id, { body, frontmatter });
        if (!groups.has(this.storePath)) groups.set(this.storePath, { filePaths: [], ids: [] });
        const g = groups.get(this.storePath)!;
        g.filePaths.push(frag.file_path);
        g.ids.push(id);
      } catch (e) {
        console.error(`[bulkReview] fragment ${id} failed:`, e);
        errors++;
      }
    }

    let done = 0;
    for (const [, { filePaths, ids: gIds }] of groups) {
      try {
        const hash = await this.git.commitFiles(
          filePaths,
          `chore: bulk review ${gIds.length} fragments by ${userId}`,
        );
        await this.db
          .update(fragments)
          .set({ quality: 'reviewed', updated_at: now, git_hash: hash })
          .where(inArray(fragments.id, gIds));
        await this.audit.log({
          user_id: userId,
          role: 'contributor',
          action: 'bulk_review',
          fragment_id: gIds.join(','),
          ip_source: ip,
        });
        const batch = gIds.flatMap((id) => {
          const item = indexData.get(id);
          if (!item) return [];
          const { body, frontmatter: fm } = item;
          return [{ id, body, metadata: { type: fm.type, domain: fm.domain, lang: fm.lang, quality: 'reviewed', author: fm.author, tags: fm.tags ?? [], access_read: fm.access?.read ?? ['*'], created_at: fm.created_at, updated_at: now, function_type: fm.function_type ?? null, audience: fm.audience ?? [], maturity: fm.maturity ?? null } }];
        });
        if (batch.length > 0) await this.searchService.indexBatch(batch).catch((e) => console.error('[bulkReview] vector index failed:', e));
        done += gIds.length;
        onProgress?.(done);
      } catch (e) {
        console.error(`[bulkReview] git commit failed:`, e);
        errors += gIds.length;
      }
    }
    // Fire supersedure detection in background, sequentially to avoid N concurrent LLM calls.
    if (this.llmClient && done > 0) {
      const reviewedIds = [...groups.values()].flatMap((g) => g.ids);
      void (async () => {
        for (const id of reviewedIds) {
          await detectAndPropose(id, this.db, this.llmClient!).catch(() => {});
        }
      })();
    }

    return { done, errors };
  }

  async bulkApprove(
    ids: string[],
    userId: string,
    ip: string | undefined,
    onProgress?: (done: number) => void,
  ): Promise<{ done: number; errors: number }> {
    const now = new Date().toISOString();
    type Group = { filePaths: string[]; ids: string[] };
    const groups = new Map<string, Group>();
    const indexData = new Map<string, { body: string; frontmatter: any }>();
    let errors = 0;

    for (const id of ids) {
      try {
        const [frag] = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
        if (!frag || frag.quality !== 'reviewed') continue;
        const existingAbsPath = join(this.storePath, frag.file_path);
        const { frontmatter, body } = readFragment(existingAbsPath);
        frontmatter.quality = 'approved';
        frontmatter.approved_by = userId;
        frontmatter.updated_at = now;
        writeFragment(dirname(existingAbsPath), frontmatter, body);
        indexData.set(id, { body, frontmatter });
        if (!groups.has(this.storePath)) groups.set(this.storePath, { filePaths: [], ids: [] });
        const g = groups.get(this.storePath)!;
        g.filePaths.push(frag.file_path);
        g.ids.push(id);
      } catch (e) {
        console.error(`[bulkApprove] fragment ${id} failed:`, e);
        errors++;
      }
    }

    let done = 0;
    for (const [, { filePaths, ids: gIds }] of groups) {
      try {
        const hash = await this.git.commitFiles(
          filePaths,
          `chore: bulk approve ${gIds.length} fragments by ${userId}`,
        );
        await this.db
          .update(fragments)
          .set({ quality: 'approved', updated_at: now, git_hash: hash })
          .where(inArray(fragments.id, gIds));
        await this.audit.log({
          user_id: userId,
          role: 'expert',
          action: 'bulk_approve',
          fragment_id: gIds.join(','),
          ip_source: ip,
        });
        const batch = gIds.flatMap((id) => {
          const item = indexData.get(id);
          if (!item) return [];
          const { body, frontmatter: fm } = item;
          return [{ id, body, metadata: { type: fm.type, domain: fm.domain, lang: fm.lang, quality: 'approved', author: fm.author, tags: fm.tags ?? [], access_read: fm.access?.read ?? ['*'], created_at: fm.created_at, updated_at: now, function_type: fm.function_type ?? null, audience: fm.audience ?? [], maturity: fm.maturity ?? null } }];
        });
        if (batch.length > 0) await this.searchService.indexBatch(batch).catch((e) => console.error('[bulkApprove] vector index failed:', e));
        done += gIds.length;
        onProgress?.(done);
      } catch (e) {
        console.error(`[bulkApprove] git commit failed:`, e);
        errors += gIds.length;
      }
    }
    this.indexService?.invalidateCache();
    return { done, errors };
  }

  // "archive" in user-facing terms = set quality to 'deprecated' internally.
  // Unlike bulkReview/bulkApprove which enforce strict transition guards, this
  // intentionally allows deprecation from any quality state — admin override authority.
  async bulkDeprecate(
    ids: string[],
    userId: string,
    ip: string | undefined,
    onProgress?: (done: number) => void,
  ): Promise<{ done: number; errors: number }> {
    const now = new Date().toISOString();
    type Group = { filePaths: string[]; ids: string[] };
    const groups = new Map<string, Group>();
    let errors = 0;

    for (const id of ids) {
      try {
        const [frag] = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
        if (!frag || frag.quality === 'deprecated') continue; // already deprecated → skip (idempotent)
        const existingAbsPath = join(this.storePath, frag.file_path);
        const { frontmatter, body } = readFragment(existingAbsPath);
        frontmatter.quality = 'deprecated';
        frontmatter.updated_at = now;
        writeFragment(dirname(existingAbsPath), frontmatter, body);
        if (!groups.has(this.storePath)) groups.set(this.storePath, { filePaths: [], ids: [] });
        const g = groups.get(this.storePath)!;
        g.filePaths.push(frag.file_path);
        g.ids.push(id);
      } catch (e) {
        console.error(`[bulkDeprecate] fragment ${id} failed:`, e);
        errors++;
      }
    }

    let done = 0;
    for (const [, { filePaths, ids: gIds }] of groups) {
      try {
        const hash = await this.git.commitFiles(
          filePaths,
          `chore: bulk archive ${gIds.length} fragments by ${userId}`,
        );
        await this.db
          .update(fragments)
          .set({ quality: 'deprecated', updated_at: now, git_hash: hash })
          .where(inArray(fragments.id, gIds));
        await this.audit.log({
          user_id: userId,
          role: 'admin',
          action: 'bulk_archive',
          fragment_id: gIds.join(','),
          ip_source: ip,
        });
        done += gIds.length;
        onProgress?.(done);
      } catch (e) {
        console.error(`[bulkDeprecate] git commit failed:`, e);
        errors += gIds.length;
      }
    }

    // Remove all IDs from search index (best-effort)
    for (const id of ids) {
      try {
        await this.searchService.removeFromIndex(id);
      } catch {
        /* ignore */
      }
    }
    this.indexService?.invalidateCache();
    return { done, errors };
  }

  async bulkDelete(
    ids: string[],
    userId: string,
    ip: string | undefined,
    onProgress?: (done: number) => void,
    role: string = 'admin',
  ): Promise<{ done: number; errors: number }> {
    type Group = { filePaths: string[]; ids: string[] };
    const groups = new Map<string, Group>();
    let errors = 0;

    for (const id of ids) {
      try {
        const [frag] = await this.db.select().from(fragments).where(eq(fragments.id, id)).limit(1);
        if (!frag) continue;
        if (!groups.has(this.storePath)) groups.set(this.storePath, { filePaths: [], ids: [] });
        const g = groups.get(this.storePath)!;
        g.filePaths.push(frag.file_path);
        g.ids.push(id);
      } catch (e) {
        console.error(`[bulkDelete] fragment ${id} failed:`, e);
        errors++;
      }
    }

    let done = 0;
    for (const [, { filePaths, ids: gIds }] of groups) {
      try {
        await this.git.rmFiles(
          filePaths,
          `chore: bulk delete ${gIds.length} fragments by ${userId}`,
        );
        await this.db.delete(fragments).where(inArray(fragments.id, gIds));
        for (const id of gIds) await this.searchService.removeFromIndex(id);
        await this.audit.log({
          user_id: userId,
          role,
          action: 'bulk_delete',
          fragment_id: gIds.join(','),
          ip_source: ip,
        });
        done += gIds.length;
        onProgress?.(done);
      } catch (e) {
        console.error(`[bulkDelete] git commit failed:`, e);
        errors += gIds.length;
      }
    }
    this.indexService?.invalidateCache();
    return { done, errors };
  }

  async bulkCreateDraftFragments(
    items: Array<{
      type: string;
      domain: string;
      lang: string;
      body: string;
      tags: string[];
      origin: 'manual' | 'harvested' | 'generated';
      function_type: string | null;
      audience: string[];
      maturity: string | null;
      harvest_confidence?: number;
      collectionSlug?: string;
    }>,
    author: string,
  ): Promise<Array<{ idx: number; id: string; file_path: string; commit_hash: string }>> {
    // NOTE: This method does NOT insert into fragment_tag_links.
    // Callers (e.g. harvester-validation.ts bulkAccept) are responsible
    // for inserting tag links after calling this method.
    const now = new Date().toISOString();
    const { mkdirSync } = await import('node:fs');
    type Group = {
      items: Array<{ idx: number; id: string; relPath: string; item: (typeof items)[number] }>;
    };
    const groups = new Map<string, Group>();

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      try {
        const id = generateId();
        const fragmentsDir = this.fragmentsDir(item.collectionSlug);
        mkdirSync(fragmentsDir, { recursive: true });

        const frontmatter = {
          id,
          type: item.type,
          domain: item.domain,
          tags: item.tags,
          lang: item.lang,
          translation_of: null,
          quality: 'draft' as const,
          author,
          reviewed_by: null,
          approved_by: null,
          created_at: now,
          updated_at: now,
          valid_from: null,
          valid_until: null,
          parent_id: null,
          generation: 0,
          uses: 0,
          last_used: null,
          access: { read: ['*'], write: ['contributor', 'admin'], approve: ['expert', 'admin'] },
          origin: item.origin,
          function_type: item.function_type,
          audience: item.audience,
          maturity: item.maturity,
          harvest_confidence: item.harvest_confidence ?? null,
        };

        const absPath = writeFragment(fragmentsDir, frontmatter, item.body);
        const relPath = relative(this.storePath, absPath);

        if (!groups.has(this.storePath)) {
          groups.set(this.storePath, { items: [] });
        }
        groups.get(this.storePath)!.items.push({ idx, id, relPath, item });
      } catch (e) {
        console.error(`[bulkCreate] item ${idx} failed to prepare:`, e);
      }
    }

    const results: Array<{ idx: number; id: string; file_path: string; commit_hash: string }> = [];

    for (const [, { items: groupItems }] of groups) {
      try {
        const filePaths = groupItems.map((i) => i.relPath);
        const commitHash = await this.git.commitFiles(
          filePaths,
          `chore: bulk accept ${groupItems.length} harvested fragments by ${author}`,
        );

        await this.db.insert(fragments).values(
          groupItems.map(({ id, relPath, item }) => ({
            id,
            type: item.type,
            domain: item.domain,
            lang: item.lang,
            quality: 'draft' as const,
            author,
            title: deriveTitle(item.body),
            body_excerpt: item.body.slice(0, 200),
            created_at: now,
            updated_at: now,
            file_path: relPath,
            git_hash: commitHash,
            collection_slug: item.collectionSlug ?? 'common',
            origin: item.origin,
            parent_id: null,
            translation_of: null,
            tags: item.tags.length > 0 ? JSON.stringify(item.tags) : null,
            valid_from: null,
            valid_until: null,
            function_type: item.function_type,
            audience: item.audience ? JSON.stringify(item.audience) : null,
            maturity: item.maturity,
            harvest_confidence: item.harvest_confidence ?? null,
          })),
        );

        for (const { idx, id, relPath } of groupItems) {
          results.push({ idx, id, file_path: relPath, commit_hash: commitHash });
        }
      } catch (e) {
        console.error(`[bulkCreate] commit/insert failed:`, e);
      }
    }

    return results;
  }
}
