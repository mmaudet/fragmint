const ORIGIN_CONFIG: Record<string, { label: string; className: string }> = {
  manual: { label: 'Manuel', className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
  harvested: { label: 'Harvest', className: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' },
  generated: { label: 'Généré', className: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' },
};

export function OriginBadge({ origin }: { origin: string }) {
  const config = ORIGIN_CONFIG[origin] ?? { label: origin, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs ${config.className}`}>
      {config.label}
    </span>
  );
}
