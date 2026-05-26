type Quality = 'draft' | 'reviewed' | 'approved' | 'deprecated';

const STATUS_CONFIG: Record<Quality, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  reviewed: { label: 'Reviewed', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  approved: { label: 'Approved', className: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  deprecated: { label: 'Archivé', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
};

export function StatusBadge({ quality }: { quality: string }) {
  const config = STATUS_CONFIG[quality as Quality] ?? {
    label: quality,
    className: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap ${config.className}`}>
      {config.label}
    </span>
  );
}
