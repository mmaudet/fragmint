import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { QualityBadge } from './quality-badge'
import { cn } from '@/lib/utils'
import type { Fragment } from '@/api/types'

interface FragmentCardProps {
  fragment: Fragment;
  onClick: () => void;
  selected?: boolean;
}

export function FragmentCard({ fragment, onClick, selected }: FragmentCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:border-primary/50',
        selected && 'border-primary bg-primary/5'
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm truncate">
            {fragment.title || 'Sans titre'}
          </h3>
          <QualityBadge quality={fragment.quality} />
        </div>
        <div className="flex gap-1.5 mt-2">
          <Badge variant="secondary" className="text-xs">{fragment.type}</Badge>
          <Badge variant="secondary" className="text-xs">{fragment.lang}</Badge>
          <Badge variant="outline" className="text-xs">{fragment.domain}</Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
          {fragment.body_excerpt || '\u2014'}
        </p>
      </CardContent>
    </Card>
  )
}
