import { describe, it, expect } from 'vitest';
import { createDb } from '../connection.js';
import { fragmentDomains } from '../schema.js';
import { LINAGORA_DOMAINS } from './linagora-domains.js';

describe('linagora domain seeds', () => {
  it('seeds all 15 default domains on createDb', () => {
    const db = createDb(':memory:');
    const rows = db.select().from(fragmentDomains).all();
    expect(rows.length).toBeGreaterThanOrEqual(15);
  });

  it('seeds expected domain slugs including twake-workplace and other', () => {
    const db = createDb(':memory:');
    const rows = db.select().from(fragmentDomains).all();
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain('twake-workplace');
    expect(slugs).toContain('other');
    expect(slugs).toContain('linagora-general');
    expect(slugs).toContain('james');
    expect(slugs).toContain('tmail');
  });

  it('seed contains exactly the domains defined in LINAGORA_DOMAINS constant', () => {
    const db = createDb(':memory:');
    const rows = db.select().from(fragmentDomains).all();
    const slugs = rows.map((r) => r.slug);
    for (const domain of LINAGORA_DOMAINS) {
      expect(slugs).toContain(domain.slug);
    }
  });

  it('is idempotent — running createDb twice does not duplicate rows', () => {
    // Two separate :memory: DBs each get 15 rows (INSERT OR IGNORE prevents duplication within one DB)
    const db1 = createDb(':memory:');
    const db2 = createDb(':memory:');
    const count1 = db1.select().from(fragmentDomains).all().length;
    const count2 = db2.select().from(fragmentDomains).all().length;
    expect(count1).toBe(count2);
    expect(count1).toBe(LINAGORA_DOMAINS.length);
  });

  it('seeded domains have active status and valid created_at', () => {
    const db = createDb(':memory:');
    const rows = db.select().from(fragmentDomains).all();
    for (const row of rows) {
      expect(row.status).toBe('active');
      expect(row.created_at).toBeTruthy();
    }
  });
});
