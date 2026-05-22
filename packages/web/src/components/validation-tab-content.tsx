import { useState } from 'react';
import type { Fragment } from '@/api/types';
import { FragmentCard } from '@/components/fragment-card';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

const PAGE_SIZE_OPTIONS = [24, 48, 96];

interface BulkAction {
  label: React.ReactNode;
  count: number;
  onClick: () => void;
  isPending: boolean;
}

interface ValidationTabContentProps {
  fragments: Fragment[];
  total: number | undefined;
  isLoading: boolean;
  isSearching: boolean;
  page: number;
  onPageChange: (p: number) => void;
  pageSize: number;
  onPageSizeChange: (s: number) => void;
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  description: string;
  emptyText: string;
  selectedCardId: string | null;
  selectedIds: Set<string>;
  onCardClick: (id: string) => void;
  onToggle: ((id: string) => void) | undefined;
  onSelectAll?: () => Promise<void>;
  isAllSelected?: boolean;
  bulkAction: BulkAction | null;
  secondaryBulkAction?: BulkAction | null;
}

function Pagination({
  page, total, pageSize, onChange, onPageSizeChange,
}: {
  page: number; total: number; pageSize: number;
  onChange: (p: number) => void; onPageSizeChange: (s: number) => void;
}) {
  const { t } = useI18n();
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{t('common', 'show')}</span>
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
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
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm text-muted-foreground">Page {page + 1} / {pageCount}</span>
        <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function ValidationTabContent({
  fragments, total, isLoading, isSearching, page, onPageChange, pageSize, onPageSizeChange,
  search, onSearchChange, searchPlaceholder, description, emptyText,
  selectedCardId, selectedIds, onCardClick, onToggle, onSelectAll, isAllSelected, bulkAction,
  secondaryBulkAction,
}: ValidationTabContentProps) {
  const { t } = useI18n();
  const [selectingAll, setSelectingAll] = useState(false);

  const handleSelectAll = async () => {
    if (!onSelectAll) return;
    setSelectingAll(true);
    try { await onSelectAll(); } finally { setSelectingAll(false); }
  };

  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={onSearchChange} placeholder={searchPlaceholder} />

      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">{description}</p>
        {onSelectAll && !isLoading && fragments.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectAll}
            disabled={selectingAll || bulkAction?.isPending}
          >
            {selectingAll ? '…' : isAllSelected ? t('validation', 'deselectAll') : t('validation', 'selectAll')}
          </Button>
        )}
        {bulkAction && bulkAction.count > 0 && (
          <Button size="sm" onClick={bulkAction.onClick} disabled={bulkAction.isPending}>
            {bulkAction.label} ({bulkAction.count})
          </Button>
        )}
        {secondaryBulkAction && secondaryBulkAction.count > 0 && (
          <Button
            size="sm"
            variant="destructive"
            onClick={secondaryBulkAction.onClick}
            disabled={secondaryBulkAction.isPending}
          >
            {secondaryBulkAction.label} ({secondaryBulkAction.count})
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)}
        </div>
      ) : fragments.length > 0 ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {fragments.map((f) => (
              <FragmentCard
                key={f.id}
                fragment={f}
                onClick={() => onCardClick(f.id)}
                selected={f.id === selectedCardId}
                checked={selectedIds.has(f.id)}
                onCheckedChange={onToggle ? () => onToggle(f.id) : undefined}
              />
            ))}
          </div>
          {!isSearching && (
            <Pagination
              page={page}
              total={total ?? 0}
              pageSize={pageSize}
              onChange={onPageChange}
              onPageSizeChange={onPageSizeChange}
            />
          )}
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">{emptyText}</p>
      )}
    </div>
  );
}
