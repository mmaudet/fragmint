import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useFragments, useSearchFragments } from '@/api/hooks/use-fragments';
import { useFragmentTypes } from '@/api/hooks/use-fragment-types';
import { useDomains } from '@/api/hooks/use-taxonomy';
import { useCurrentUser, canDelete } from '@/api/hooks/use-current-user';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { apiRequest, apiRequestFull, collectionApiUrl } from '@/api/client';
import type { Fragment } from '@/api/types';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { FragmentCard } from '@/components/fragment-card';
import { FragmentDetail } from '@/components/fragment-detail';
import { SearchInput } from '@/components/search-input';
import { CollectionSelector } from '@/components/collection-selector';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const PAGE_SIZE_OPTIONS = [24, 48, 96];
const QUALITY_VALUES = ['draft', 'reviewed', 'approved'];
const LANG_VALUES = ['fr', 'en'];

export default function FragmentsPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [domain, setDomain] = useState('');
  const [lang, setLang] = useState('');
  const [quality, setQuality] = useState('');
  const [functionType, setFunctionType] = useState('');
  const [audience, setAudience] = useState('');
  const [maturity, setMaturity] = useState('');
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const { t } = useI18n();
  const { activeCollection } = useCollection();
  const { data: fragmentTypes = [] } = useFragmentTypes();
  const { data: domainsData = [] } = useDomains();
  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  const filters = {
    ...(type && { type }),
    ...(domain && { domain }),
    ...(lang && { lang }),
    ...(quality && { quality }),
    ...(functionType && { function_type: functionType }),
    ...(audience && { audience }),
    ...(maturity && { maturity }),
    limit: pageSize,
    offset,
  };

  const fragmentsQuery = useFragments(activeCollection, search ? {} : filters);
  const searchQuery = useSearchFragments(activeCollection, search, filters);

  const data = search ? searchQuery.data : fragmentsQuery.data;
  const total = search ? undefined : fragmentsQuery.total;
  const isLoading = search ? searchQuery.isLoading : fragmentsQuery.isLoading;

  const totalPages = total !== undefined ? Math.ceil(total / pageSize) : undefined;
  const page = Math.floor(offset / pageSize) + 1;

  const totalCount = search ? (data?.length ?? 0) : (total ?? 0);
  const isAllSelected = totalCount > 0 && selectedIds.size >= totalCount;

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setOffset(0);
    setSelectedIds(new Set());
  }, []);

  const handleSelectAll = async () => {
    if (isAllSelected) { setSelectedIds(new Set()); return; }
    if (search) {
      setSelectedIds(new Set((data ?? []).map((f) => f.id)));
    } else {
      const params = new URLSearchParams();
      if (type) params.set('type', type);
      if (domain) params.set('domain', domain);
      if (lang) params.set('lang', lang);
      if (quality) params.set('quality', quality);
      if (functionType) params.set('function_type', functionType);
      if (audience) params.set('audience', audience);
      if (maturity) params.set('maturity', maturity);
      params.set('limit', '99999');
      const { data: all } = await apiRequestFull<Fragment[]>('GET', collectionApiUrl(activeCollection, `/fragments?${params}`));
      setSelectedIds(new Set(all.map((f) => f.id)));
    }
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setBulkPending(true);
    try {
      const { job_id } = await apiRequest<{ job_id: string }>('POST', collectionApiUrl(activeCollection, '/fragments/bulk-delete'), { ids });
      toast.info(t('validation', 'bulkProcessing'));
      const poll = async (): Promise<void> => {
        const job = await apiRequest<{ status: string; done: number; error_count: number }>('GET', `/v1/jobs/${job_id}`);
        if (job.status === 'done' || job.status === 'error') {
          toast.success(`${job.done} ${t('fragments', 'bulkDeleteSuccess')}`);
          queryClient.invalidateQueries({ queryKey: ['fragments'] });
          setBulkPending(false);
        } else {
          setTimeout(poll, 1000);
        }
      };
      poll();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
      setBulkPending(false);
    }
  };

  const handlePageSizeChange = (value: string) => {
    setPageSize(Number(value));
    setOffset(0);
    setSelectedIds(new Set());
  };

  return (
    <div className="p-6 space-y-6">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <h2 className="text-2xl font-bold">{t('fragments', 'title')}</h2>
          {!search && total !== undefined && (
            <span className="text-sm text-muted-foreground">{total} fragments</span>
          )}
          <CollectionSelector />
        </div>
        <div className="w-72">
          <SearchInput
            value={search}
            onChange={handleSearch}
            placeholder={t('fragments', 'searchPlaceholder')}
          />
        </div>
      </div>

      {/* Filter row */}
      <div className="flex flex-wrap gap-3">
        {([
          { value: type, set: setType, allLabel: t('fragments', 'allTypes'), width: 'w-44',
            items: fragmentTypes.map((ft) => ({ value: ft.slug, label: ft.label })) },
          { value: domain, set: setDomain, allLabel: t('fragments', 'allDomains'), width: 'w-48',
            items: domainsData.map((d) => ({ value: d.slug, label: d.label ?? d.slug })) },
          { value: functionType, set: setFunctionType, allLabel: t('fragments', 'allFunctions'), width: 'w-44',
            items: [
              { value: 'technical', label: t('fragments', 'functionTechnical') },
              { value: 'commercial', label: t('fragments', 'functionCommercial') },
              { value: 'legal', label: t('fragments', 'functionLegal') },
              { value: 'operational', label: t('fragments', 'functionOperational') },
              { value: 'strategic', label: t('fragments', 'functionStrategic') },
              { value: 'reference', label: t('fragments', 'functionReference') },
            ] },
          { value: audience, set: setAudience, allLabel: t('fragments', 'allAudiences'), width: 'w-40',
            items: [
              { value: 'technical', label: t('fragments', 'audienceTechnical') },
              { value: 'decision-maker', label: t('fragments', 'audienceDecisionMaker') },
              { value: 'user', label: t('fragments', 'audienceUser') },
              { value: 'legal', label: t('fragments', 'audienceLegal') },
            ] },
          { value: maturity, set: setMaturity, allLabel: t('fragments', 'allMaturities'), width: 'w-40',
            items: [
              { value: 'production', label: t('fragments', 'maturityProduction') },
              { value: 'beta', label: t('fragments', 'maturityBeta') },
              { value: 'roadmap', label: t('fragments', 'maturityRoadmap') },
              { value: 'archive', label: t('fragments', 'maturityArchive') },
            ] },
          { value: lang, set: setLang, allLabel: t('fragments', 'allLanguages'), width: 'w-36',
            items: LANG_VALUES.map((v) => ({ value: v, label: t('fragments', v === 'fr' ? 'langFr' : 'langEn') })) },
          { value: quality, set: setQuality, allLabel: t('fragments', 'allQualities'), width: 'w-40',
            items: QUALITY_VALUES.map((q) => ({ value: q, label: t('quality', q as 'draft' | 'reviewed' | 'approved') })) },
        ] as { value: string; set: (v: string) => void; allLabel: string; width: string; items: { value: string; label: string }[] }[]).map(({ value: val, set, allLabel, width, items }) => (
          <Select key={allLabel} value={val || '__all__'} onValueChange={(v) => { set(v === '__all__' ? '' : v); setOffset(0); setSelectedIds(new Set()); }}>
            <SelectTrigger className={width}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{allLabel}</SelectItem>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>

      {/* Selection bar (admin only) */}
      {canDelete(currentUser) && !isLoading && data && data.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleSelectAll} disabled={bulkPending}>
            {isAllSelected ? t('fragments', 'deselectAll') : t('fragments', 'selectAll')}
          </Button>
          {selectedIds.size > 0 && (
            <Button size="sm" variant="destructive" onClick={handleBulkDelete} disabled={bulkPending}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {t('fragments', 'bulkDelete')} ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Fragment list */}
      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: pageSize > 20 ? 9 : 5 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((fragment) => (
            <FragmentCard
              key={fragment.id}
              fragment={fragment}
              selected={fragment.id === selectedId}
              onClick={() => setSelectedId(fragment.id)}
              checked={selectedIds.has(fragment.id)}
              onCheckedChange={canDelete(currentUser) ? () => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  next.has(fragment.id) ? next.delete(fragment.id) : next.add(fragment.id);
                  return next;
                });
              } : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 text-muted-foreground">
          {t('fragments', 'noFragments')}
        </div>
      )}

      {/* Pagination */}
      {!search && total !== undefined && total > PAGE_SIZE_OPTIONS[0] && (
        <div className="flex items-center justify-between gap-4">
          {totalPages !== undefined && totalPages > 1 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{t('common', 'show')}</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span>{t('common', 'perPage')}</span>
            </div>
          )}
          <div className="flex items-center gap-3 ml-auto">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
            >
              {t('common', 'previous')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('common', 'page')} {page}{totalPages !== undefined ? ` / ${totalPages}` : ''}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!data || data.length < pageSize}
              onClick={() => setOffset((o) => o + pageSize)}
            >
              {t('common', 'next')}
            </Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      <FragmentDetail
        fragmentId={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
