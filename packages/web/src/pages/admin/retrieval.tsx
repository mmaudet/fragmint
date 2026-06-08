import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import {
  useRetrievalMode,
  useSetRetrievalMode,
  type RetrievalMode,
} from '@/api/hooks/use-retrieval-mode';
import { useSectionTopK, useSetSectionTopK } from '@/api/hooks/use-section-top-k';
import { useIndexStatus, useTriggerReindex } from '@/api/hooks/use-index';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Zap,
  Brain,
  Layers3,
  CheckCircle2,
  RefreshCw,
  AlertTriangle,
  Database,
} from 'lucide-react';

interface ModeSpec {
  value: RetrievalMode;
  icon: React.ElementType;
  label: { fr: string; en: string };
  tagline: { fr: string; en: string };
  how: { fr: string; en: string };
  pros: { fr: string[]; en: string[] };
  cons: { fr: string[]; en: string[] };
  latency: string;
  recommended?: boolean;
}

const MODES: ModeSpec[] = [
  {
    value: 'vector-only',
    icon: Zap,
    label: { fr: 'Vectoriel', en: 'Vector-only' },
    tagline: {
      fr: 'Similarité sémantique + re-ranking qualité',
      en: 'Semantic similarity + quality re-ranking',
    },
    how: {
      fr: "La requête est transformée en vecteur par le modèle d'embedding, puis comparée à tous les fragments de la collection. Les fragments les plus proches vectoriellement sont renvoyés, avec un re-ranking qualité (statut, fraîcheur, usage).",
      en: 'The query is embedded, then compared to all fragments in the collection by cosine similarity. The nearest fragments are returned, with quality re-ranking (status, freshness, usage).',
    },
    pros: {
      fr: [
        'Ultra-rapide : ~100ms',
        'Prévisible et reproductible',
        'Idéal pour les grandes bibliothèques (>10 000 fragments)',
        'Pas de dépendance au LLM pendant la recherche',
      ],
      en: [
        'Ultra-fast: ~100ms',
        'Predictable and reproducible',
        'Ideal for large libraries (10k+ fragments)',
        'No LLM dependency during search',
      ],
    },
    cons: {
      fr: [
        'Ne comprend pas la sémantique fine ni le contexte métier',
        'Peut rater des fragments si le vocabulaire diffère',
        'Sensible à la qualité des embeddings',
        'Risque de domain drift sur des vaults multi-produits',
      ],
      en: [
        'Misses fine semantics and business context',
        'Can miss relevant fragments when vocabulary differs',
        'Sensitive to embedding quality',
        'Domain drift risk on multi-product vaults',
      ],
    },
    latency: '~100ms',
  },
  {
    value: 'hybrid',
    icon: Layers3,
    label: { fr: 'Hybride', en: 'Hybrid' },
    tagline: {
      fr: 'Pré-filtrage sémantique + re-ranking',
      en: 'Semantic pre-filter + re-ranking',
    },
    how: {
      fr: 'Les N meilleurs candidats sont sélectionnés par similarité vectorielle (pré-filtrage rapide), puis re-rankés selon la pertinence sémantique réelle et le contexte du document.',
      en: 'The top N candidates are selected by vector similarity (fast pre-filter), then re-ranked by true semantic relevance and document context.',
    },
    pros: {
      fr: [
        'Bon rapport qualité/vitesse',
        'Re-ranking contextuel : tient compte du contexte de la requête',
        'Meilleure précision que le mode vectoriel seul',
      ],
      en: [
        'Good quality/speed tradeoff',
        'Contextual re-ranking: uses the query context',
        'Higher precision than vector-only mode',
      ],
    },
    cons: {
      fr: [
        'Latence 1–3s selon la taille du lot',
        'Sensible au domain drift si le vault est hétérogène',
      ],
      en: [
        '1–3s latency depending on batch size',
        'Sensitive to domain drift on heterogeneous vaults',
      ],
    },
    latency: '1–3s',
  },
  {
    value: 'agentic-only',
    icon: Brain,
    label: { fr: 'Vectorless RAG', en: 'Vectorless RAG' },
    tagline: {
      fr: 'Sélection LLM via index condensé — sans base vectorielle',
      en: 'LLM selection via condensed index — no vector database',
    },
    how: {
      fr: "Un index des fragments est dynamiquement maintenu, qui contient un résumé condensé de chaque fragment. Le LLM sélectionne les fragments de chaque section via cet index, puis s'auto-review par rapport au contenu des fragments et de leur pertinence pour la section.",
      en: "A fragment index is dynamically maintained, containing a condensed summary of each fragment. The LLM selects fragments for each section via this index, then self-reviews against the actual fragment content and its relevance to the section.",
    },
    pros: {
      fr: [
        'Meilleure qualité : raisonnement LLM complet sur le contexte du document',
        'Résiste au domain drift — discrimine les produits entre eux',
        "Comprend l'intention même avec un vocabulaire très différent",
        'Fonctionne sans base vectorielle (mode souverain)',
      ],
      en: [
        'Best quality: full LLM reasoning with document context',
        'Resistant to domain drift — discriminates between products',
        'Understands intent even with very different vocabulary',
        'Works without a vector database (sovereign mode)',
      ],
    },
    cons: {
      fr: [
        'Lent : latence cumulée proportionnelle au nombre de sections',
        'Coût LLM élevé',
        'Non scalable sur des bibliothèques de >1 000 fragments sans index structuré',
      ],
      en: [
        'Slow: cumulative latency proportional to the number of sections',
        'High LLM cost',
        'Not scalable for libraries >1k fragments without structured index',
      ],
    },
    latency: 'variable',
    recommended: true,
  },
];

export default function AdminRetrievalPage() {
  const { lang } = useI18n();
  const { data } = useRetrievalMode();
  const setMode = useSetRetrievalMode();
  const current = data?.mode ?? null;
  const { data: indexStatus, isLoading: statusLoading } = useIndexStatus();
  const reindex = useTriggerReindex();

  const [pending, setPending] = useState<RetrievalMode | null>(null);
  const { data: topKData } = useSectionTopK();
  const setTopK = useSetSectionTopK();
  const [pendingTopK, setPendingTopK] = useState<number | null>(null);
  const currentTopK = topKData?.top_k ?? 5;

  // Initialise pending to current once loaded
  useEffect(() => {
    if (current && pending === null) setPending(current);
  }, [current, pending]);

  useEffect(() => {
    if (topKData && pendingTopK === null) setPendingTopK(topKData.top_k);
  }, [topKData, pendingTopK]);

  const selected = pending;
  const isDirty = selected !== null && selected !== current;

  const l = (obj: { fr: string; en: string }) => (lang === 'en' ? obj.en : obj.fr);
  const la = (obj: { fr: string[]; en: string[] }) => (lang === 'en' ? obj.en : obj.fr);

  const handleReindex = () => {
    reindex.mutate(undefined, {
      onSuccess: (data) => {
        toast.success(
          lang === 'fr'
            ? `Réindexation terminée — ${data.indexed} fragment(s) indexé(s)`
            : `Reindex done — ${data.indexed} fragment(s) indexed`,
        );
      },
      onError: () => toast.error(lang === 'fr' ? 'Erreur de réindexation' : 'Reindex failed'),
    });
  };

  const handleSave = () => {
    if (!selected || !isDirty || setMode.isPending) return;
    setMode.mutate(selected, {
      onSuccess: () => {
        const label = MODES.find((m) => m.value === selected)?.label;
        toast.success(`Mode ${label ? l(label) : selected} activé`);
      },
      onError: () => toast.error('Erreur lors du changement de mode'),
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {lang === 'fr' ? 'Modes de retrieval' : 'Retrieval modes'}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {lang === 'fr'
              ? "Choisissez comment Fragmint recherche les fragments pertinents lors d'une requête."
              : 'Choose how Fragmint searches for relevant fragments on a query.'}
          </p>
        </div>
        {isDirty && (
          <Button
            onClick={handleSave}
            disabled={setMode.isPending}
            className="shrink-0 bg-red-700 hover:bg-red-800 text-white"
          >
            {setMode.isPending
              ? lang === 'fr'
                ? 'Enregistrement…'
                : 'Saving…'
              : lang === 'fr'
                ? 'Sauvegarder'
                : 'Save'}
          </Button>
        )}
      </div>

      {/* Milvus status banner */}
      {!statusLoading && indexStatus && (
        <div
          className={cn(
            'flex items-center justify-between gap-4 rounded-lg border px-4 py-3',
            indexStatus.milvus
              ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20',
          )}
        >
          <div className="flex items-center gap-3">
            <Database
              className={cn(
                'h-4 w-4 shrink-0',
                indexStatus.milvus ? 'text-emerald-600' : 'text-amber-600',
              )}
            />
            <div className="text-sm">
              {indexStatus.milvus ? (
                <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                  {lang === 'fr' ? 'Index sémantique connecté' : 'Semantic index connected'}
                  <span className="ml-2 font-normal text-emerald-600 dark:text-emerald-500">
                    {lang === 'fr'
                      ? `— retrieval : ${indexStatus.retrieval_mode === 'vector-only' ? 'vectoriel' : indexStatus.retrieval_mode === 'hybrid' ? 'hybride' : 'Vectorless RAG'}`
                      : `— retrieval: ${indexStatus.retrieval_mode === 'agentic-only' ? 'Vectorless RAG' : (indexStatus.retrieval_mode ?? indexStatus.mode)}`}
                  </span>
                </span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {lang === 'fr'
                    ? 'Base vectorielle non disponible — les modes Vectoriel et Hybride ne fonctionneront pas'
                    : 'Vector database unavailable — Vector-only and Hybrid modes will not work'}
                </span>
              )}
            </div>
          </div>
          {indexStatus.milvus && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReindex}
              disabled={reindex.isPending}
              className="shrink-0 border-emerald-300 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-400"
            >
              <RefreshCw
                className={cn('h-3.5 w-3.5 mr-1.5', reindex.isPending && 'animate-spin')}
              />
              {reindex.isPending
                ? lang === 'fr'
                  ? 'Réindexation…'
                  : 'Reindexing…'
                : lang === 'fr'
                  ? 'Réindexer les fragments'
                  : 'Reindex fragments'}
            </Button>
          )}
        </div>
      )}

      {/* Mode cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {MODES.map((mode) => {
          const Icon = mode.icon;
          const isSelected = selected === mode.value;
          const isActive = current === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => setPending(mode.value)}
              className={cn(
                'text-left rounded-lg border p-5 space-y-4 transition-all h-full flex flex-col',
                isSelected
                  ? 'border-red-600 bg-red-50 dark:bg-red-950/20 ring-1 ring-red-600'
                  : 'border-border hover:border-red-400 hover:bg-muted/30',
              )}
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Icon
                    className={cn(
                      'h-5 w-5 shrink-0',
                      isSelected ? 'text-red-600' : 'text-muted-foreground',
                    )}
                  />
                  <span
                    className={cn(
                      'font-semibold text-base',
                      isSelected && 'text-red-700 dark:text-red-400',
                    )}
                  >
                    {l(mode.label)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                  {mode.recommended && (
                    <Badge variant="outline" className="text-xs border-amber-400 text-amber-600">
                      {lang === 'fr' ? 'Recommandé' : 'Recommended'}
                    </Badge>
                  )}
                  {isActive && (
                    <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600 text-white flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {lang === 'fr' ? 'Actif' : 'Active'}
                    </Badge>
                  )}
                </div>
              </div>

              {/* Tagline */}
              <p className="text-xs text-muted-foreground">{l(mode.tagline)}</p>

              {/* How it works */}
              <div className="space-y-1.5 text-sm">
                <p className="font-medium text-foreground/80 text-xs uppercase tracking-wide">
                  {lang === 'fr' ? 'Comment ça marche' : 'How it works'}
                </p>
                <p className="text-muted-foreground leading-relaxed text-xs">{l(mode.how)}</p>
              </div>

              {/* Pros */}
              <div className="space-y-1.5 text-xs">
                <p className="font-medium text-emerald-700 dark:text-emerald-400">
                  {lang === 'fr' ? 'Avantages' : 'Pros'}
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  {la(mode.pros).map((p) => (
                    <li key={p} className="flex gap-1.5 items-start">
                      <span className="text-emerald-500 shrink-0 mt-px">+</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Cons */}
              <div className="space-y-1.5 text-xs">
                <p className="font-medium text-red-700 dark:text-red-400">
                  {lang === 'fr' ? 'Limites' : 'Cons'}
                </p>
                <ul className="space-y-1 text-muted-foreground">
                  {la(mode.cons).map((c) => (
                    <li key={c} className="flex gap-1.5 items-start">
                      <span className="text-red-500 shrink-0 mt-px">−</span>
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Spacer pushes footer to bottom */}
              <div className="flex-1" />

              {/* Latency footer */}
              <div className="pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>{lang === 'fr' ? 'Latence typique' : 'Typical latency'}</span>
                <span className="font-mono font-semibold">{mode.latency}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Section top-k */}
      <div className="rounded-lg border px-4 py-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-sm font-medium mb-1">
              {lang === 'fr' ? 'Fragments par section (top_k)' : 'Fragments per section (top_k)'}
            </p>
            <p className="text-xs text-muted-foreground">
              {lang === 'fr'
                ? 'Nombre de fragments candidats retenus en sortie pour chaque section du plan. Le retriever explore un pool plus large en interne, puis n\'en conserve que top_k.'
                : 'Number of candidate fragments returned per plan section. The retriever explores a larger pool internally, then keeps only top_k.'}
            </p>

            {/* Per-mode phase explanation */}
            <div className="mt-3 space-y-2">
              {[
                {
                  mode: 'hybrid' as const,
                  label: lang === 'fr' ? 'Hybride' : 'Hybrid',
                  phases: lang === 'fr'
                    ? [`Phase 1 — Vecteur : top_k × 4 candidats par similarité cosine`, `Phase 2 — Juge LLM : score 0-10 sur tous les candidats`, `Fusion RRF → top_k résultats finaux`]
                    : [`Phase 1 — Vector: top_k × 4 candidates by cosine similarity`, `Phase 2 — LLM judge: 0-10 score on all candidates`, `RRF fusion → top_k final results`],
                },
                {
                  mode: 'vector-only' as const,
                  label: lang === 'fr' ? 'Vectoriel' : 'Vector-only',
                  phases: lang === 'fr'
                    ? [`Recherche Milvus directe → top_k résultats (pas de juge LLM)`]
                    : [`Direct Milvus search → top_k results (no LLM judge)`],
                },
                {
                  mode: 'agentic-only' as const,
                  label: lang === 'fr' ? 'Vectorless RAG' : 'Vectorless RAG',
                  phases: lang === 'fr'
                    ? [`Phase 0 — TOC : filtrage domaine/type si corpus > 200 fragments`, `Phase 1 — LLM : sélection de top_k × 4 candidats dans l'index`, `Phase 2 — LLM : scoring par auto-consistance → top_k résultats`]
                    : [`Phase 0 — TOC: domain/type filtering if corpus > 200 fragments`, `Phase 1 — LLM: selects top_k × 4 candidates from index`, `Phase 2 — LLM: self-consistency scoring → top_k results`],
                },
              ].map(({ mode, label, phases }) => (
                <div key={mode} className={`rounded px-3 py-2 text-xs ${current === mode ? 'bg-primary/8 border border-primary/20' : 'bg-muted/40'}`}>
                  <span className={`font-medium ${current === mode ? 'text-primary' : 'text-foreground/70'}`}>
                    {label}{current === mode && (lang === 'fr' ? ' — actif' : ' — active')}
                  </span>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {phases.map((p) => <li key={p} className="before:content-['→_'] before:opacity-40">{p}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Integer input */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <input
              type="number"
              min={1}
              max={20}
              value={pendingTopK ?? currentTopK}
              onChange={(e) => {
                const v = Math.max(1, Math.min(20, parseInt(e.target.value) || 1));
                setPendingTopK(v);
              }}
              className="w-16 text-center text-2xl font-bold font-mono border rounded-md py-1 bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">1 – 20</span>
          </div>
        </div>

        {pendingTopK !== null && pendingTopK !== currentTopK && (
          <div className="flex gap-2 justify-end pt-1 border-t">
            <Button variant="ghost" size="sm" onClick={() => setPendingTopK(currentTopK)}>
              {lang === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
            <Button
              size="sm"
              onClick={() => setTopK.mutate(pendingTopK, { onSuccess: () => toast.success(`top_k = ${pendingTopK}`) })}
              disabled={setTopK.isPending}
            >
              {setTopK.isPending ? (lang === 'fr' ? 'Enregistrement…' : 'Saving…') : (lang === 'fr' ? 'Appliquer' : 'Apply')}
            </Button>
          </div>
        )}
      </div>

      {/* Save banner when dirty */}
      {isDirty && (
        <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 px-4 py-3 text-sm">
          <span className="text-red-700 dark:text-red-300">
            {lang === 'fr'
              ? `Mode sélectionné : ${l(MODES.find((m) => m.value === selected)!.label)} — cliquez Sauvegarder pour appliquer.`
              : `Selected mode: ${l(MODES.find((m) => m.value === selected)!.label)} — click Save to apply.`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPending(current)}
              className="text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-900"
            >
              {lang === 'fr' ? 'Annuler' : 'Cancel'}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={setMode.isPending}
              className="bg-red-700 hover:bg-red-800 text-white"
            >
              {setMode.isPending
                ? lang === 'fr'
                  ? 'Enregistrement…'
                  : 'Saving…'
                : lang === 'fr'
                  ? 'Sauvegarder'
                  : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
