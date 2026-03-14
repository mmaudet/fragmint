import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const qualityStyles = {
  approved: 'bg-green-100 text-green-800 border-green-200',
  reviewed: 'bg-amber-100 text-amber-800 border-amber-200',
  draft: 'bg-gray-100 text-gray-700 border-gray-200',
  deprecated: 'bg-red-100 text-red-800 border-red-200',
} as const;

interface QualityBadgeProps {
  quality: keyof typeof qualityStyles;
}

export function QualityBadge({ quality }: QualityBadgeProps) {
  return (
    <Badge variant="outline" className={cn(qualityStyles[quality])}>
      {quality}
    </Badge>
  )
}
