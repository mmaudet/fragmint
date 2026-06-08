import type { PlanSection } from '../schema/plan.js';
import type { FragmentService } from './fragment-service.js';
import type { FragmentCollectionService } from './fragment-collection-service.js';

async function payloadFromFragment(
  fragmentsSvc: FragmentService,
  fragmentId: string,
): Promise<Record<string, unknown>> {
  const frag = await fragmentsSvc.getById(fragmentId);
  if (!frag?.payload) return {};
  try {
    return JSON.parse(frag.payload) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Resolve rows from a collection_id directly (for blocks-based sections). */
export async function resolveRowsFromCollection(
  collectionId: string,
  collectionService: FragmentCollectionService,
  fragmentsSvc: FragmentService,
): Promise<Record<string, unknown>[]> {
  const col = await collectionService.getById(collectionId);
  if (!col) return [];
  return Promise.all(col.member_ids.map((fid) => payloadFromFragment(fragmentsSvc, fid)));
}

/** Resolve rows from a section's table_source (legacy render_mode: 'table'). */
export async function resolveTableRows(
  section: PlanSection,
  collectionService: FragmentCollectionService | undefined,
  fragmentsSvc: FragmentService | undefined,
): Promise<Record<string, unknown>[]> {
  if (!fragmentsSvc) return [];
  const source = section.table_source;

  if (source?.collection_id && collectionService) {
    return resolveRowsFromCollection(source.collection_id, collectionService, fragmentsSvc);
  }

  if (source?.fragment_ids) {
    return Promise.all(source.fragment_ids.map((fid) => payloadFromFragment(fragmentsSvc, fid)));
  }

  // Fallback: use selected fragment payloads
  return Promise.all(
    section.selected.map((sel) => payloadFromFragment(fragmentsSvc, sel.fragment_id)),
  );
}
