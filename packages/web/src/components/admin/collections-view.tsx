import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { FragmentCollection, Fragment } from '@/api/types';
import { FragmentDetail } from '@/components/fragment-detail';
import { ConfirmModal } from '@/components/admin/confirm-modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSchemaLabel } from '@/components/payload-editor';
import { useI18n } from '@/lib/i18n';
import { useDeleteFragmentCollectionBatch } from '@/api/hooks/use-plans';
import { ChevronDown, ChevronRight, ChevronUp, FileText, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

function useAllFragmentCollections() {
  return useQuery<FragmentCollection[]>({
    queryKey: ['fragment-collections-admin'],
    queryFn: () => apiRequest<FragmentCollection[]>('GET', '/v1/fragment-collections?limit=200'),
  });
}

function useFragmentsByIds(ids: string[], enabled: boolean) {
  return useQuery<Fragment[]>({
    queryKey: ['fragments-by-ids', ids],
    enabled: enabled && ids.length > 0,
    queryFn: async () => {
      const results = await Promise.all(
        ids.map((id) => apiRequest<Fragment>('GET', `/v1/fragments/${id}`).catch(() => null)),
      );
      return results.filter(Boolean) as Fragment[];
    },
  });
}

function CollectionRow({
  col,
  selected,
  onToggle,
}: {
  col: FragmentCollection;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [openFragmentId, setOpenFragmentId] = useState<string | null>(null);
  const { data: fragments } = useFragmentsByIds(col.member_ids, expanded);
  const { t, lang } = useI18n();
  const getSchemaLabel = useSchemaLabel();

  return (
    <>
      <tr
        className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="py-2.5 px-3 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(col.id)}
            className="accent-primary cursor-pointer"
          />
        </td>
        <td className="py-2.5 px-3 font-medium text-sm">{col.title}</td>
        <td className="py-2.5 px-3">
          {col.payload_schema && (
            <Badge variant="outline" className="text-xs border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              📊 {getSchemaLabel(col.payload_schema)}
            </Badge>
          )}
        </td>
        <td className="py-2.5 px-3 text-sm text-muted-foreground text-center">
          {col.member_ids.length}
        </td>
        <td className="py-2.5 px-3 text-xs text-muted-foreground truncate max-w-[200px]">
          {col.source_document && (
            <span className="flex items-center gap-1">
              <FileText className="h-3 w-3 shrink-0" />
              {col.source_document}
            </span>
          )}
        </td>
        <td className="py-2.5 px-3 text-xs text-muted-foreground whitespace-nowrap">
          {new Date(col.created_at).toLocaleDateString(lang === 'en' ? 'en-GB' : 'fr-FR')}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b bg-muted/10">
          <td colSpan={7} className="px-8 py-2">
            {!fragments ? (
              <p className="text-xs text-muted-foreground py-1">{t('common', 'loading')}</p>
            ) : fragments.length === 0 ? (
              <p className="text-xs text-muted-foreground py-1">{t('admin', 'tablesNoFragments')}</p>
            ) : (
              <ul className="space-y-1 py-1">
                {fragments.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 text-sm rounded px-2 py-1 hover:bg-muted/50 cursor-pointer"
                    onClick={(e) => { e.stopPropagation(); setOpenFragmentId(f.id); }}
                  >
                    <span className="font-mono text-xs text-muted-foreground w-20 shrink-0">
                      {f.id.slice(0, 12)}
                    </span>
                    <span className="font-medium truncate flex-1">{f.title ?? '—'}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{f.lang}</Badge>
                    <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0">
                      {t('admin', 'tablesOpen')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}

      <FragmentDetail
        fragmentId={openFragmentId}
        open={!!openFragmentId}
        onClose={() => setOpenFragmentId(null)}
      />
    </>
  );
}

type SortCol = 'title' | 'rows' | 'date' | 'schema' | 'source';
type SortDir = 'asc' | 'desc';
const DEFAULT_DIR: Record<SortCol, SortDir> = { title: 'asc', rows: 'desc', date: 'desc', schema: 'asc', source: 'asc' };

function SortHeader({
  label,
  col,
  sort,
  onSort,
  className,
}: {
  label: string;
  col: SortCol;
  sort: string;
  onSort: (col: SortCol, dir: SortDir) => void;
  className?: string;
}) {
  const isAsc = sort === `${col}_asc`;
  const isDesc = sort === `${col}_desc`;
  const active = isAsc || isDesc;
  const toggle = () => {
    if (!active) onSort(col, DEFAULT_DIR[col]);
    else onSort(col, isAsc ? 'desc' : 'asc');
  };
  return (
    <button
      onClick={toggle}
      className={`flex items-center gap-1 select-none uppercase tracking-wide ${className ?? ''}`}
    >
      <span>{label}</span>
      {isAsc ? (
        <ChevronUp className="h-3 w-3" />
      ) : isDesc ? (
        <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}

export function CollectionsView() {
  const { data: collections, isLoading } = useAllFragmentCollections();
  const [schemaFilter, setSchemaFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { t } = useI18n();
  const deleteMutation = useDeleteFragmentCollectionBatch();

  const handleSort = (col: SortCol, dir: SortDir) => setSort(`${col}_${dir}`);

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });

  const toggleSelectAll = (ids: string[]) =>
    setSelected((prev) => ids.every((id) => prev.has(id)) ? new Set() : new Set(ids));

  const SCHEMA_FILTERS = [
    { value: '', label: t('admin', 'tablesFilterAll') },
    { value: 'pricing-line-v1', label: t('admin', 'tablesFilterPricing') },
    { value: 'sla-row-v1', label: t('admin', 'tablesFilterSla') },
    { value: 'reference-v1', label: t('admin', 'tablesFilterReference') },
    { value: 'generic-row-v1', label: t('admin', 'tablesFilterGeneric') },
  ];

  const filtered = (collections ?? [])
    .filter((c) => {
      if (schemaFilter && c.payload_schema !== schemaFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return c.title.toLowerCase().includes(q) || (c.source_document ?? '').toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (sort === 'date_asc') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === 'title_asc') return a.title.localeCompare(b.title);
      if (sort === 'title_desc') return b.title.localeCompare(a.title);
      if (sort === 'rows_asc') return a.member_ids.length - b.member_ids.length;
      if (sort === 'rows_desc') return b.member_ids.length - a.member_ids.length;
      if (sort === 'schema_asc') return (a.payload_schema ?? '').localeCompare(b.payload_schema ?? '');
      if (sort === 'schema_desc') return (b.payload_schema ?? '').localeCompare(a.payload_schema ?? '');
      if (sort === 'source_asc') return (a.source_document ?? '').localeCompare(b.source_document ?? '');
      if (sort === 'source_desc') return (b.source_document ?? '').localeCompare(a.source_document ?? '');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">{t('common', 'loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            {filtered.length} {t('admin', 'tablesCountSuffix')}
          </p>
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowDeleteConfirm(true)}
              className="flex items-center gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t('admin', 'tablesDeleteSelected')} ({selected.size})
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder={t('admin', 'tablesSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 border rounded-md text-sm flex-1 min-w-[180px] bg-background"
          />
          <select
            value={schemaFilter}
            onChange={(e) => setSchemaFilter(e.target.value)}
            className="px-2 py-1.5 border rounded-md text-sm bg-background"
          >
            {SCHEMA_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground text-sm">
          {t('admin', 'tablesEmpty')}
          {(schemaFilter || search) && (
            <button className="ml-1 underline" onClick={() => { setSchemaFilter(''); setSearch(''); }}>
              {t('admin', 'tablesResetFilter')}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                <th className="w-8 px-3 py-2">
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((c) => selected.has(c.id))}
                    onChange={() => toggleSelectAll(filtered.map((c) => c.id))}
                    className="accent-primary cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2 text-left">
                  <SortHeader label={t('admin', 'tablesColTitle')} col="title" sort={sort} onSort={handleSort} />
                </th>
                <th className="px-3 py-2 text-left">
                  <SortHeader label={t('admin', 'tablesColRowType')} col="schema" sort={sort} onSort={handleSort} />
                </th>
                <th className="px-3 py-2 text-center w-20">
                  <SortHeader label={t('admin', 'tablesColRows')} col="rows" sort={sort} onSort={handleSort} className="justify-center w-full" />
                </th>
                <th className="px-3 py-2 text-left">
                  <SortHeader label={t('admin', 'tablesColSource')} col="source" sort={sort} onSort={handleSort} />
                </th>
                <th className="px-3 py-2 text-left w-24">
                  <SortHeader label={t('admin', 'tablesColDate')} col="date" sort={sort} onSort={handleSort} />
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((col) => (
                <CollectionRow key={col.id} col={col} selected={selected.has(col.id)} onToggle={toggleSelect} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showDeleteConfirm && (
        <ConfirmModal
          title={t('admin', 'tablesDeleteConfirmTitle')}
          message={t('admin', 'tablesDeleteConfirmMsg')}
          confirmLabel={t('admin', 'tablesDeleteConfirmBtn')}
          variant="danger"
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            try {
              await deleteMutation.mutateAsync([...selected]);
              toast.success(`${selected.size} tableau(x) supprimé(s)`);
              setSelected(new Set());
            } catch (e: any) {
              toast.error(`Erreur : ${e.message}`);
            } finally {
              setShowDeleteConfirm(false);
            }
          }}
        />
      )}
    </div>
  );
}
