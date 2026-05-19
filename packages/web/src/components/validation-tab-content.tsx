import type { Fragment } from '@/api/types';
import { FragmentCard } from '@/components/fragment-card';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_SIZE = 24;

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
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  description: string;
  emptyText: string;
  selectedCardId: string | null;
  selectedIds: Set<string>;
  onCardClick: (id: string) => void;
  onToggle: ((id: string) => void) | undefined;
  bulkAction: BulkAction | null;
}

function Pagination({ page, total, onChange }: { page: number; total: number; onChange: (p: number) => void }) {
  const pageCount = Math.ceil(total / PAGE_SIZE);
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-4">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-sm text-muted-foreground">Page {page + 1} / {pageCount}</span>
      <Button variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function ValidationTabContent({
  fragments, total, isLoading, isSearching, page, onPageChange,
  search, onSearchChange, searchPlaceholder, description, emptyText,
  selectedCardId, selectedIds, onCardClick, onToggle, bulkAction,
}: ValidationTabContentProps) {
  return (
    <div className="space-y-4">
      <SearchInput value={search} onChange={onSearchChange} placeholder={searchPlaceholder} />

      <div className="flex items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1">{description}</p>
        {bulkAction && bulkAction.count > 0 && (
          <Button size="sm" onClick={bulkAction.onClick} disabled={bulkAction.isPending}>
            {bulkAction.label} ({bulkAction.count})
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
          {!isSearching && <Pagination page={page} total={total ?? 0} onChange={onPageChange} />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground py-8 text-center">{emptyText}</p>
      )}
    </div>
  );
}
