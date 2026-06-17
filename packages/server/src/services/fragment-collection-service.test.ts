import { describe, it, expect, beforeEach } from 'vitest';
import { createDb } from '../db/connection.js';
import { FragmentCollectionService } from './fragment-collection-service.js';

describe('FragmentCollectionService', () => {
  let service: FragmentCollectionService;

  beforeEach(() => {
    const db = createDb(':memory:');
    service = new FragmentCollectionService(db);
  });

  it('create() returns an id', async () => {
    const result = await service.create({
      title: 'Test Collection',
      createdBy: 'alice',
    });

    expect(result.id).toMatch(/^fc_/);
  });

  it('list() returns the created collection', async () => {
    await service.create({
      title: 'My Collection',
      description: 'A test description',
      collectionSlug: 'common',
      createdBy: 'bob',
    });

    const items = await service.list({ collectionSlug: 'common' });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('My Collection');
    expect(items[0].description).toBe('A test description');
    expect(items[0].collection_slug).toBe('common');
    expect(items[0].member_ids).toEqual([]);
  });

  it('getById() returns null for unknown id', async () => {
    const result = await service.getById('fc_does-not-exist');
    expect(result).toBeNull();
  });
});
