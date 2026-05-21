import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { QualityBadge } from './quality-badge';
import { cn } from '@/lib/utils';
import type { Fragment } from '@/api/types';

interface FragmentCardProps {
  fragment: Fragment;
  onClick: () => void;
  selected?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function FragmentCard({ fragment, onClick, selected, checked, onCheckedChange }: FragmentCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50',
        selected && 'border-primary bg-primary/5 ring-1 ring-primary/30',
        !selected && checked && 'border-slate-400/60 ring-1 ring-slate-400/20',
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          {onCheckedChange && (
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => onCheckedChange(!!v)}
              onClick={(e) => e.stopPropagation()}
              className="mt-0.5 shrink-0 data-[state=checked]:bg-slate-500 data-[state=checked]:border-slate-500 border-slate-400"
            />
          )}
          <h3 className="font-semibold text-sm truncate flex-1">{fragment.title || 'Sans titre'}</h3>
          <QualityBadge quality={fragment.quality} />
        </div>
        <div className="flex gap-1.5 mt-2">
          <Badge variant="outline" className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300">{fragment.type}</Badge>
          <Badge variant="outline" className="text-xs border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300">{fragment.domain}</Badge>
          <Badge variant="outline" className="text-xs">{fragment.lang}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {fragment.body_excerpt || '—'}
        </p>
      </CardContent>
    </Card>
  );
}
