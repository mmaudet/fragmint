import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { useFragments, useSearchFragments } from '@/api/hooks/use-fragments';
import { apiRequest, apiRequestFull, collectionApiUrl } from '@/api/client';
import type { Fragment } from '@/api/types';
import { useI18n } from '@/lib/i18n';
import { useCollection } from '@/lib/collection-context';
import { CollectionSelector } from '@/components/collection-selector';
import { useCurrentUser, canReview } from '@/api/hooks/use-current-user';
import { ValidationTabContent } from '@/components/validation-tab-content';
import { FragmentDetail } from '@/components/fragment-detail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { BookOpen, Loader2, Trash2 } from 'lucide-react';

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
const hasRole = (role: string, min: string) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 999);

export default function ValidationPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'reader';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(24);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPending, setBulkPending] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
  const [deletePending, setDeletePending] = useState(false);
  const { t } = useI18n();
  const { activeCollection } = useCollection();

  const {
    data: fragments,
    total,
    isLoading,
  } = useFragments(activeCollection, {
    quality: 'draft',
    limit: pageSize,
    offset: page * pageSize,
  });
  const { data: searchResults, isLoading: isSearching } = useSearchFragments(
    activeCollection,
    search,
    { quality: 'draft' },
  );

  const { data: currentUser } = useCurrentUser();
  const queryClient = useQueryClient();

  const isSearchMode = search.length > 0;
  const list = isSearchMode ? (searchResults ?? []) : (fragments ?? []);
  const countForSelect = isSearchMode ? list.length : total;
  const isAllSelected = !!countForSelect && selectedIds.size >= countForSelect;

  const toggle = (set: Set<string>, id: string) => {
    const s = new Set(set);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  };

  const fetchAllIds = async () => {
    const { data } = await apiRequestFull<Fragment[]>(
      'GET',
      collectionApiUrl(activeCollection, `/fragments?quality=draft&limit=99999`),
    );
    return data.map((f) => f.id);
  };

  const handleSelectAll = async () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
      return;
    }
    const ids = isSearchMode ? (searchResults ?? []).map((f) => f.id) : await fetchAllIds();
    setSelectedIds(new Set(ids));
  };

  const startBulk = async (endpoint: string, ids: string[], clearFn: () => void) => {
    clearFn();
    setBulkPending(true);
    try {
      const { job_id } = await apiRequest<{ job_id: string }>(
        'POST',
        collectionApiUrl(activeCollection, endpoint),
        { ids },
      );
      toast.info(t('validation', 'bulkProcessing'));
      const poll = async (): Promise<void> => {
        const job = await apiRequest<{ status: string; done: number; error_count: number }>(
          'GET',
          `/v1/jobs/${job_id}`,
        );
        if (job.status === 'done' || job.status === 'error') {
          if (job.status === 'done' || (job.status === 'error' && job.done > 0)) {
            const msg =
              job.error_count > 0
                ? `${job.done} ${t('validation', 'bulkDoneWithErrors')} ${job.error_count} ${t('validation', 'bulkErrors')}`
                : `${job.done} ${t('validation', 'bulkDone')}`;
            toast.success(msg);
            queryClient.invalidateQueries({ queryKey: ['fragments'] });
          } else {
            toast.error(`${t('validation', 'bulkError')} (${job.error_count} fragment(s))`);
            queryClient.invalidateQueries({ queryKey: ['fragments'] });
          }
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

  const isAdmin = (currentUser?.role ?? '') === 'admin';

  const handleBulkDelete = (ids: string[]) => {
    setPendingDeleteIds(ids);
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (pendingDeleteIds.length === 0) return;
    const endpoint = isAdmin ? '/fragments/bulk-delete' : '/fragments/bulk-delete-own';
    setDeleteConfirmOpen(false);
    setDeletePending(true);
    try {
      const result = await apiRequest<{ job_id: string | null; done?: number }>(
        'POST',
        collectionApiUrl(activeCollection, endpoint),
        { ids: pendingDeleteIds },
      );
      if (!result.job_id) {
        toast.info(t('validation', 'noOwned'));
        setDeletePending(false);
        return;
      }
      toast.info(t('validation', 'bulkProcessing'));
      let attempts = 0;
      const poll = async (): Promise<void> => {
        try {
          const job = await apiRequest<{ status: string; done: number; error_count: number }>(
            'GET',
            `/v1/jobs/${result.job_id}`,
          );
          if (job.status === 'done' || job.status === 'error') {
            toast.success(`${job.done} ${t('fragments', 'bulkDeleteSuccess')}`);
            queryClient.invalidateQueries({ queryKey: ['fragments'] });
            setSelectedIds(new Set());
            setDeletePending(false);
          } else if (++attempts < 120) {
            setTimeout(poll, 1000);
          } else {
            toast.error(t('validation', 'pollTimeout'));
            setDeletePending(false);
          }
        } catch (e: any) {
          toast.error(e.message ?? 'Erreur');
          setDeletePending(false);
        }
      };
      poll();
    } catch (e: any) {
      toast.error(e.message ?? 'Erreur');
      setDeletePending(false);
    }
  };

  if (!hasRole(role, 'contributor')) return <Navigate to="/home" replace />;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-6">
        <h2 className="text-2xl font-bold">{t('validation', 'title')}</h2>
        <CollectionSelector />
      </div>

      <ValidationTabContent
        fragments={list}
        total={total}
        isLoading={isSearchMode ? isSearching : isLoading}
        isSearching={isSearchMode}
        page={page}
        onPageChange={setPage}
        pageSize={pageSize}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(0);
        }}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        searchPlaceholder={t('fragments', 'searchPlaceholder')}
        description={t('validation', 'reviewTabDesc')}
        emptyText={t('validation', 'noFragmentsPendingReview')}
        selectedCardId={selectedId}
        selectedIds={selectedIds}
        onCardClick={setSelectedId}
        onToggle={canReview(currentUser) ? (id) => setSelectedIds((p) => toggle(p, id)) : undefined}
        onSelectAll={canReview(currentUser) ? handleSelectAll : undefined}
        isAllSelected={isAllSelected}
        bulkAction={
          selectedIds.size > 0
            ? {
                label: (
                  <>
                    <BookOpen className="mr-2 h-3.5 w-3.5" />
                    {t('fragments', 'markReviewed')}
                  </>
                ),
                count: selectedIds.size,
                onClick: () =>
                  startBulk('/fragments/bulk-review', Array.from(selectedIds), () =>
                    setSelectedIds(new Set()),
                  ),
                isPending: bulkPending,
              }
            : null
        }
        secondaryBulkAction={
          selectedIds.size > 0 && (isAdmin || canReview(currentUser))
            ? {
                label: (
                  <>
                    <Trash2 className="mr-2 h-3.5 w-3.5" />
                    {t('validation', 'deleteSelected')}
                  </>
                ),
                count: selectedIds.size,
                onClick: () => handleBulkDelete(Array.from(selectedIds)),
                isPending: deletePending,
              }
            : null
        }
      />

      <FragmentDetail
        fragmentId={selectedId}
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
      />

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('validation', 'deleteSelected')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            {t('validation', 'deleteSelectedConfirm')}
            {!isAdmin && (
              <span className="block mt-1 text-xs opacity-70">
                Seuls vos propres fragments non approuvés seront supprimés.
              </span>
            )}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              {t('validation', 'cancel')}
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deletePending}>
              {deletePending ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4 mr-1" />
              )}
              {t('validation', 'deleteSelected')} ({pendingDeleteIds.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
