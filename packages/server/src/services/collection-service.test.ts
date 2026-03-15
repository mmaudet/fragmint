import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb } from '../db/connection.js';
import { CollectionService } from './collection-service.js';
import type { FragmintDb } from '../db/connection.js';

describe('CollectionService', () => {
  let dir: string;
  let db: FragmintDb;
  let service: CollectionService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fragmint-col-'));
    db = createDb(':memory:');
    service = new CollectionService(db, { collections_path: dir });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true });
  });

  it('creates a team collection with valid slug', async () => {
    const col = await service.create(
      {
        slug: 'my-team',
        name: 'My Team',
        type: 'team',
        description: 'A team collection',
      },
      'alice',
    );

    expect(col.id).toMatch(/^col-/);
    expect(col.slug).toBe('my-team');
    expect(col.name).toBe('My Team');
    expect(col.type).toBe('team');
    expect(col.git_path).toBe(join(dir, 'my-team'));
    expect(col.milvus_partition).toBe('col_my_team');
  });

  it('rejects invalid slugs (uppercase, spaces, too short)', async () => {
    await expect(
      service.create({ slug: 'MyTeam', name: 'T', type: 'team' }, 'alice'),
    ).rejects.toThrow('lowercase');

    await expect(
      service.create({ slug: 'my team', name: 'T', type: 'team' }, 'alice'),
    ).rejects.toThrow('lowercase');

    await expect(
      service.create({ slug: 'a', name: 'T', type: 'team' }, 'alice'),
    ).rejects.toThrow('at least 2');
  });

  it('listForUser returns collections with roles', async () => {
    await service.create(
      { slug: 'team-alpha', name: 'Alpha', type: 'team' },
      'alice',
    );
    await service.addMember('team-alpha', 'bob', 'contributor', 'alice');

    await service.create(
      { slug: 'team-beta', name: 'Beta', type: 'team' },
      'alice',
    );
    await service.addMember('team-beta', 'bob', 'reader', 'alice');

    const list = await service.listForUser('bob');
    expect(list.length).toBe(2);

    const slugs = list.map((c) => c.slug).sort();
    expect(slugs).toEqual(['team-alpha', 'team-beta']);

    const alpha = list.find((c) => c.slug === 'team-alpha');
    expect(alpha!.role).toBe('contributor');
  });

  it('addMember + checkAccess works for valid membership', async () => {
    await service.create(
      { slug: 'team-check', name: 'Check', type: 'team' },
      'alice',
    );
    await service.addMember('team-check', 'bob', 'expert', 'alice');

    // expert (2) >= contributor (1)
    expect(
      await service.checkAccess('bob', null, 'team-check', 'contributor'),
    ).toBe(true);

    // expert (2) >= expert (2)
    expect(
      await service.checkAccess('bob', null, 'team-check', 'expert'),
    ).toBe(true);

    // expert (2) < manager (3)
    expect(
      await service.checkAccess('bob', null, 'team-check', 'manager'),
    ).toBe(false);
  });

  it('checkAccess returns false for no membership', async () => {
    await service.create(
      { slug: 'team-noaccess', name: 'NoAccess', type: 'team' },
      'alice',
    );

    expect(
      await service.checkAccess('stranger', null, 'team-noaccess', 'reader'),
    ).toBe(false);
  });

  it('ensurePersonalCollection creates on first call, returns existing on second', async () => {
    const first = await service.ensurePersonalCollection('user-1', 'johndoe');
    expect(first.slug).toBe('personal-johndoe');
    expect(first.type).toBe('personal');

    const second = await service.ensurePersonalCollection('user-1', 'johndoe');
    expect(second.id).toBe(first.id);

    // Verify owner membership was set
    const hasAccess = await service.checkAccess(
      'user-1',
      null,
      'personal-johndoe',
      'owner',
    );
    expect(hasAccess).toBe(true);
  });
});
