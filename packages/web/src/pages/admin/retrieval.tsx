import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useRetrievalMode, useSetRetrievalMode, type RetrievalMode } from '@/api/hooks/use-retrieval-mode';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Zap, Brain, Layers3, CheckCircle2 } from 'lucide-react';

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
      fr: 'Similarité cosinus sur les embeddings Milvus',
      en: 'Cosine similarity on Milvus embeddings',
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
      ],
      en: [
        'Misses fine semantics and business context',
        'Can miss relevant fragments when vocabulary differs',
        'Sensitive to embedding quality',
      ],
    },
    latency: '~100ms',
  },
  {
    value: 'hybrid',
    icon: Layers3,
    label: { fr: 'Hybride', en: 'Hybrid' },
    tagline: {
      fr: 'Pré-filtrage Milvus + re-ranking LLM',
      en: 'Milvus pre-filter + LLM re-ranking',
    },
    how: {
      fr: 'Milvus sélectionne les N meilleurs candidats par similarité vectorielle (pré-filtrage rapide). Un LLM juge ensuite chaque fragment et réordonne les résultats selon la pertinence sémantique réelle. Recommandé pour la démo et la production.',
      en: 'Milvus selects the top N candidates by vector similarity (fast pre-filter). An LLM then judges each fragment and reorders results by true semantic relevance. Recommended for demo and production.',
    },
    pros: {
      fr: [
        'Meilleur rapport qualité/vitesse',
        'Le LLM comprend le contexte métier et les nuances',
        'Réduit les faux positifs vectoriels',
        'Recommandé pour les démos client',
      ],
      en: [
        'Best quality/speed tradeoff',
        'LLM understands business context and nuances',
        'Reduces vector false positives',
        'Recommended for client demos',
      ],
    },
    cons: {
      fr: [
        'Latence 1–3s selon la taille du lot',
        'Coût LLM par requête',
        'Qualité dépend du modèle LLM configuré',
      ],
      en: [
        '1–3s latency depending on batch size',
        'LLM cost per query',
        'Quality depends on the configured LLM model',
      ],
    },
    latency: '1–3s',
    recommended: true,
  },
  {
    value: 'agentic-only',
    icon: Brain,
    label: { fr: 'Agentique', en: 'Agentic' },
    tagline: {
      fr: "LLM juge sur l'index Karpathy (index.md)",
      en: 'LLM judge over the Karpathy index (index.md)',
    },
    how: {
      fr: "Un LLM parcourt l'index de la bibliothèque (index.md — résumés par section, inspiré du LLM Wiki de Karpathy) et sélectionne les fragments les plus pertinents sans passer par Milvus. Chaque section est évaluée indépendamment.",
      en: "An LLM navigates the library index (index.md — section summaries, inspired by Karpathy's LLM Wiki) and selects the most relevant fragments without Milvus. Each section is evaluated independently.",
    },
    pros: {
      fr: [
        'Qualité maximale : raisonnement LLM complet',
        'Fonctionne sans Milvus (mode dégradé souverain)',
        "Comprend l'intention même avec un vocabulaire très différent",
        "Idéal pour évaluer la qualité de l'index",
      ],
      en: [
        'Maximum quality: full LLM reasoning',
        'Works without Milvus (sovereign fallback mode)',
        'Understands intent even with very different vocabulary',
        'Ideal for evaluating index quality',
      ],
    },
    cons: {
      fr: [
        'Lent : 2–5s par section, cumulatif',
        'Coût LLM élevé',
        'Non scalable sur des bibliothèques de >1 000 fragments sans index structuré',
        'Non recommandé en production',
      ],
      en: [
        'Slow: 2–5s per section, cumulative',
        'High LLM cost',
        'Not scalable for libraries >1k fragments without structured index',
        'Not recommended for production',
      ],
    },
    latency: '2–5s/section',
  },
];

export default function AdminRetrievalPage() {
  const { lang } = useI18n();
  const { data } = useRetrievalMode();
  const setMode = useSetRetrievalMode();
  const current = data?.mode ?? null;

  const [pending, setPending] = useState<RetrievalMode | null>(null);

  // Initialise pending to current once loaded
  useEffect(() => {
    if (current && pending === null) {
      setPending(current);
    }
  }, [current, pending]);

  const selected = pending;
  const isDirty = selected !== null && selected !== current;

  const l = (obj: { fr: string; en: string }) => (lang === 'en' ? obj.en : obj.fr);
  const la = (obj: { fr: string[]; en: string[] }) => (lang === 'en' ? obj.en : obj.fr);

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
              ? lang === 'fr' ? 'Enregistrement…' : 'Saving…'
              : lang === 'fr' ? 'Sauvegarder' : 'Save'}
          </Button>
        )}
      </div>

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
                  <span className={cn('font-semibold text-base', isSelected && 'text-red-700 dark:text-red-400')}>
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
              <div className="space-y-1.5 text-sm flex-1">
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

              {/* Latency footer */}
              <div className="pt-3 border-t flex items-center justify-between text-xs text-muted-foreground">
                <span>{lang === 'fr' ? 'Latence typique' : 'Typical latency'}</span>
                <span className="font-mono font-semibold">{mode.latency}</span>
              </div>
            </button>
          );
        })}
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
                ? lang === 'fr' ? 'Enregistrement…' : 'Saving…'
                : lang === 'fr' ? 'Sauvegarder' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
