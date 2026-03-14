interface CoverageBarProps {
  fr: number;
  en: number;
  label: string;
}

export function CoverageBar({ fr, en, label }: CoverageBarProps) {
  const total = fr + en;
  const frPct = total > 0 ? (fr / total) * 100 : 0;
  const enPct = total > 0 ? (en / total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">{total} fragments</span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden flex">
        {frPct > 0 && (
          <div className="bg-primary h-full" style={{ width: `${frPct}%` }} title={`FR: ${fr}`} />
        )}
        {enPct > 0 && (
          <div className="bg-primary/40 h-full" style={{ width: `${enPct}%` }} title={`EN: ${en}`} />
        )}
      </div>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>FR: {fr}</span>
        <span>EN: {en}</span>
      </div>
    </div>
  )
}
