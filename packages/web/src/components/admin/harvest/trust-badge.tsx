type TrustLevel = 'high' | 'mixed' | 'low';

function getTrustLevel(trustSourcesJson: string | null): TrustLevel {
  if (!trustSourcesJson) return 'low';
  const sources = JSON.parse(trustSourcesJson) as Record<string, string>;
  const vals = Object.values(sources);
  if (vals.includes('llm-deviation')) return 'mixed';
  if (vals.includes('llm-inferred')) return 'low';
  return 'high';
}

const CONFIG: Record<TrustLevel, { label: string; className: string }> = {
  high: { label: '✓ Trust haut', className: 'bg-green-100 text-green-800' },
  mixed: { label: '⚠ Trust mixte', className: 'bg-amber-100 text-amber-800' },
  low: { label: '⊘ Trust bas', className: 'bg-blue-100 text-blue-800' },
};

export function TrustBadge({ trustSourcesJson }: { trustSourcesJson: string | null }) {
  const level = getTrustLevel(trustSourcesJson);
  const c = CONFIG[level];
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${c.className}`}>
      {c.label}
    </span>
  );
}

export { getTrustLevel, type TrustLevel };
