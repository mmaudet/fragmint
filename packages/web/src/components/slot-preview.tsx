import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { QualityBadge } from '@/components/quality-badge';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { Fragment } from '@/api/types';

interface SlotDef {
  key: string;
  type: string;
  domain: string;
  lang: string;
  quality_min: string;
  required: boolean;
  fallback: string;
  count: number;
}

interface SlotPreviewProps {
  slot: SlotDef;
  fragments: Fragment[] | undefined;
  isLoading: boolean;
  onOverride: (key: string) => void;
}

export function SlotPreview({ slot, fragments, isLoading, onOverride }: SlotPreviewProps) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <Skeleton className="h-4 w-4 rounded-full" />
        <div className="flex-1 space-y-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
    );
  }

  const hasFragments = fragments && fragments.length > 0;

  return (
    <button
      type="button"
      onClick={() => onOverride(slot.key)}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
        hasFragments && 'border-green-200 bg-green-50',
        !hasFragments && slot.required && 'border-red-200 bg-red-50',
        !hasFragments && !slot.required && 'border-amber-200 bg-amber-50',
      )}
    >
      {hasFragments ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
      ) : (
        <AlertCircle
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            slot.required ? 'text-red-600' : 'text-amber-600',
          )}
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{slot.key}</span>
          <Badge variant="outline" className="text-xs">
            {slot.type}
          </Badge>
          {slot.required && (
            <span className="text-xs text-muted-foreground">requis</span>
          )}
        </div>

        {hasFragments ? (
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            <span className="truncate">{fragments[0].title ?? fragments[0].id}</span>
            <QualityBadge quality={fragments[0].quality} />
            {fragments.length > 1 && (
              <span className="text-xs">{fragments.length} fragments</span>
            )}
          </div>
        ) : (
          <div className="mt-1 text-sm">
            <span className={slot.required ? 'text-red-600' : 'text-amber-600'}>
              Aucun fragment
            </span>
            {slot.fallback && (
              <span className="ml-2 text-xs text-muted-foreground">
                fallback: {slot.fallback}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
