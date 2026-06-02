import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { QualityBadge } from './quality-badge';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Fragment } from '@/api/types';

function nearDupBadge(info: NonNullable<Fragment['harvest_near_dup']>) {
  const score = info.score ?? 0;
  if (score >= 0.95)
    return { label: 'Doublon', className: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300' };
  if (score >= 0.80)
    return { label: 'Forte sim.', className: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-300' };
  return { label: 'Proche de', className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300' };
}

interface FragmentCardProps {
  fragment: Fragment;
  onClick: () => void;
  selected?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function FragmentCard({
  fragment,
  onClick,
  selected,
  checked,
  onCheckedChange,
}: FragmentCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50',
        selected && 'border-primary/50 bg-primary/5',
        !selected && checked && 'border-slate-400/60',
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
          <h3 className="font-semibold text-sm truncate flex-1">
            {fragment.title || 'Sans titre'}
          </h3>
          <QualityBadge quality={fragment.quality} />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          <Badge
            variant="outline"
            className="text-xs border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
          >
            {fragment.type}
          </Badge>
          <Badge
            variant="outline"
            className="text-xs border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300"
          >
            {fragment.domain}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {fragment.lang}
          </Badge>
          {fragment.harvest_near_dup && (() => {
            const { label, className } = nearDupBadge(fragment.harvest_near_dup);
            return (
              <Badge variant="outline" className={cn('text-xs', className)}>
                {label}
                {fragment.harvest_near_dup.score != null && (
                  <span className="ml-1 opacity-75">
                    {Math.round(fragment.harvest_near_dup.score * 100)}%
                  </span>
                )}
              </Badge>
            );
          })()}
        </div>
        {fragment.origin_source && (
          <span className="text-xs text-muted-foreground truncate block max-w-full mt-2">
            📄 {fragment.origin_source}
            {fragment.origin_page != null && ` · p. ${fragment.origin_page}`}
          </span>
        )}
        {/^\|.+\|/.test(fragment.body_excerpt?.split('\n')[0] ?? '') || fragment.payload_schema ? (
          <p className="text-xs text-muted-foreground italic mt-2">
            📊 Tableau structuré ({fragment.payload_schema ?? 'données'})
          </p>
        ) : (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
            {fragment.body_excerpt || '—'}
          </p>
        )}
        {fragment.harvest_near_dup && (() => {
          const score = fragment.harvest_near_dup.score ?? 0;
          const pct = Math.round(score * 100);
          const label = score >= 0.95 ? 'Doublon quasi-exact' : score >= 0.80 ? 'Forte similarité' : 'Proche de';
          const colorCn = score >= 0.95
            ? 'text-red-600 dark:text-red-400'
            : score >= 0.80
            ? 'text-orange-600 dark:text-orange-400'
            : 'text-blue-600 dark:text-blue-400';
          return (
            <div className={cn('flex items-center gap-1 text-xs mt-1.5', colorCn)}>
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>
                {label} — <strong>{pct}%</strong>
                {fragment.harvest_near_dup.method && (
                  <span className="opacity-70"> ({fragment.harvest_near_dup.method})</span>
                )}
                {' avec '}
                <Link
                  to={`/fragments?fragment=${fragment.harvest_near_dup.fragment_id}`}
                  className="font-mono underline underline-offset-2 hover:opacity-70"
                  onClick={(e) => e.stopPropagation()}
                >
                  {fragment.harvest_near_dup.fragment_id.slice(0, 8)}…
                </Link>
              </span>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
