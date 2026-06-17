// packages/web/src/components/score-breakdown.tsx
//
// Renders score breakdown details for use inside a Tooltip.
// Define the type locally to avoid cross-package imports.

export interface ScoreBreakdownData {
  method: 'vector' | 'agentic' | 'hybrid_rrf' | 'sqlite_like';
  vector_score?: number;
  vector_rank?: number;
  llm_score?: number;
  llm_rank?: number;
  rrf_score?: number;
  rrf_k?: number;
}

interface Props {
  breakdown: ScoreBreakdownData;
  score: number | null;
  justification?: string;
}

export function ScoreBreakdown({ breakdown, score, justification }: Props) {
  if (breakdown.method === 'sqlite_like') {
    return (
      <div className="text-xs text-muted-foreground space-y-0.5 p-2 max-w-[220px]">
        <div className="font-medium text-foreground">Recherche textuelle (SQLite)</div>
        <div className="text-yellow-600 dark:text-yellow-400">
          Score non calculé — Milvus inactif
        </div>
        <div>Résultat classé par utilisation</div>
      </div>
    );
  }

  if (breakdown.method === 'agentic') {
    return (
      <div className="text-xs text-muted-foreground space-y-1 p-2 max-w-[260px]">
        <div className="font-medium text-foreground mb-1">Juge LLM (agentic)</div>
        {breakdown.llm_score != null && (
          <div className="flex justify-between gap-4">
            <span>Score</span>
            <span className="font-mono font-medium text-foreground">{breakdown.llm_score}/10</span>
          </div>
        )}
        {justification && (
          <div className="mt-1.5 pt-1.5 border-t border-border text-muted-foreground italic leading-snug">
            {justification}
          </div>
        )}
      </div>
    );
  }

  if (breakdown.method === 'hybrid_rrf') {
    return (
      <div className="text-xs text-muted-foreground space-y-1 p-2 min-w-[180px]">
        <div className="font-medium text-foreground mb-1">Détail de pertinence</div>
        <div className="flex justify-between gap-4">
          <span>Similarité sémantique</span>
          <span className="font-mono font-medium text-foreground">
            {breakdown.vector_score != null
              ? Math.round(breakdown.vector_score * 100) + '%'
              : '—'}
          </span>
        </div>
        {breakdown.llm_score != null && (
          <div className="flex justify-between gap-4">
            <span>Juge LLM</span>
            <span className="font-mono font-medium text-foreground">
              {breakdown.llm_score}/10
            </span>
          </div>
        )}
      </div>
    );
  }

  if (breakdown.method === 'vector') {
    const pct =
      breakdown.vector_score != null ? Math.round(breakdown.vector_score * 100) : null;
    return (
      <div className="text-xs text-muted-foreground space-y-0.5 p-2 max-w-[220px]">
        <div className="font-medium text-foreground">Similarité vectorielle (Milvus)</div>
        {pct != null && <div>Cosine : {pct}%</div>}
      </div>
    );
  }

  return null;
}
