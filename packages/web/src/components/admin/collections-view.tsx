import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';
import type { FragmentCollection, Fragment } from '@/api/types';
import { FragmentDetail } from '@/components/fragment-detail';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useSchemaLabel } from '@/components/payload-editor';
import { useI18n } from '@/lib/i18n';
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';

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

function CollectionRow({ col }: { col: FragmentCollection }) {
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
        <td className="py-2.5 px-3 w-8">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
            : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
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
          <td colSpan={6} className="px-8 py-2">
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

export function CollectionsView() {
  const { data: collections, isLoading } = useAllFragmentCollections();
  const [schemaFilter, setSchemaFilter] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('date_desc');
  const { t } = useI18n();

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
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  if (isLoading) return <p className="text-sm text-muted-foreground py-8 text-center">{t('common', 'loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {filtered.length} {t('admin', 'tablesCountSuffix')}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder={t('admin', 'tablesSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="px-3 py-1.5 border rounded-md text-sm flex-1 min-w-[180px] bg-background"
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="px-2 py-1.5 border rounded-md text-sm bg-background"
          >
            <option value="date_desc">{t('admin', 'tablesSortNewest')}</option>
            <option value="date_asc">{t('admin', 'tablesSortOldest')}</option>
            <option value="title_asc">{t('admin', 'tablesSortTitleAsc')}</option>
            <option value="title_desc">{t('admin', 'tablesSortTitleDesc')}</option>
          </select>
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
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left">{t('admin', 'tablesColTitle')}</th>
                <th className="px-3 py-2 text-left">{t('admin', 'tablesColRowType')}</th>
                <th className="px-3 py-2 text-center w-20">{t('admin', 'tablesColRows')}</th>
                <th className="px-3 py-2 text-left">{t('admin', 'tablesColSource')}</th>
                <th className="px-3 py-2 text-left w-24">{t('admin', 'tablesColDate')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((col) => (
                <CollectionRow key={col.id} col={col} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
