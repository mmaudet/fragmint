import { Link } from 'react-router-dom';
import {
  Tag,
  ArrowLeftRight,
  GitBranch,
  AlertTriangle,
  Users,
  Layers,
  Inbox,
  ArrowRight,
  CheckSquare,
  Network,
  BookOpen,
} from 'lucide-react';
// ArrowRight kept for TabCardItem CTA
import { cn } from '@/lib/utils';

interface TabCard {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  description: string;
  cta: string;
  link: string;
  available: boolean;
}

const TABS: TabCard[] = [
  {
    icon: Inbox,
    title: 'Inbox',
    subtitle: 'Vue unifiée des tâches en attente',
    description:
      "Votre point d'entrée quotidien. Agrège tout ce qui demande votre attention : fragments à valider, métadonnées en attente, contradictions à résoudre.",
    cta: "Ouvrir l'Inbox",
    link: '/admin/inbox',
    available: false,
  },
  {
    icon: Tag,
    title: 'Metadata',
    subtitle: 'Validation et maintenance du référentiel',
    description:
      'Gère le vocabulaire du système : sujets, entités, tags. "À valider" traite les nouvelles propositions du LLM. "Référentiel" permet la maintenance du catalogue actif.',
    cta: 'Gérer les métadonnées',
    link: '/admin/metadata',
    available: true,
  },
  {
    icon: ArrowLeftRight,
    title: 'Remplacements',
    subtitle: 'Quand un fragment en remplace un autre',
    description:
      'Quand un nouveau fragment ressemble fortement à un existant, le système suggère un remplacement. Vous comparez côte à côte et décidez : remplacer, coexister ou rejeter.',
    cta: 'Voir les remplacements',
    link: '/admin/supersedure',
    available: true,
  },
  {
    icon: GitBranch,
    title: 'Relations',
    subtitle: 'Liens explicites entre fragments',
    description:
      'Le système détecte des relations sémantiques entre fragments (détaille, illustre, complète). Vous validez pour enrichir le knowledge graph.',
    cta: 'Valider les relations',
    link: '/admin/relations',
    available: false,
  },
  {
    icon: AlertTriangle,
    title: 'Contradictions',
    subtitle: 'Incohérences factuelles détectées',
    description:
      'Détecte automatiquement les fragments qui se contredisent (deux SLA différents, deux prix différents). Critique pour garantir la cohérence des documents composés.',
    cta: 'Résoudre les contradictions',
    link: '/admin/contradictions',
    available: false,
  },
  {
    icon: Users,
    title: 'Utilisateurs',
    subtitle: 'Gestion des accès',
    description:
      'Liste des utilisateurs, gestion des rôles, désactivation de comptes, audit de qui a fait quoi.',
    cta: 'Gérer les utilisateurs',
    link: '/admin/users',
    available: true,
  },
  {
    icon: Layers,
    title: 'Collections',
    subtitle: 'Organisation des fragments',
    description:
      'Les fragments peuvent être regroupés en collections par équipe, projet ou client. Chaque collection peut être personnelle, partagée ou en lecture seule.',
    cta: 'Gérer les collections',
    link: '/admin/collections',
    available: true,
  },
  {
    icon: Network,
    title: 'Knowledge Graph',
    subtitle: 'Exploration visuelle du corpus',
    description:
      'Graphe interactif des fragments validés. Les nœuds sont les fragments approuvés. Les liens implicites relient les fragments partageant des entités ou proches sémantiquement (Milvus). Les liens explicites sont les relations validées dans le tab Relations.',
    cta: 'Explorer le graphe',
    link: '/admin/graph',
    available: false,
  },
];

const WORKFLOW_STEPS = [
  {
    step: '1',
    label: 'Ingestion',
    detail: 'Un utilisateur uploade un document source avec hints optionnels',
    tab: 'Harvest',
  },
  {
    step: '2',
    label: 'Validation candidats',
    detail: 'Vous validez les fragments extraits du document',
    tab: 'Harvest',
  },
  {
    step: '3',
    label: 'Validation métadonnées',
    detail: 'Vous validez les nouveaux tags / entités proposés par le LLM',
    tab: 'Metadata',
  },
  {
    step: '4',
    label: 'Enrichissement',
    detail: 'Validez les relations, remplacements et contradictions détectés',
    tab: 'Tabs dédiés',
  },
  {
    step: '5',
    label: 'Production',
    detail: 'Les fragments validés sont utilisables pour composer des documents',
    tab: 'Composition',
  },
];

const QUICK_START = [
  {
    label: 'Vérifiez le référentiel',
    detail:
      'Metadata > Référentiel — vérifiez que sujets, entités et tags correspondent à votre contexte métier.',
  },
  {
    label: 'Testez une ingestion',
    detail:
      'Uploadez un document que vous connaissez. Pré-remplissez les hints (domaine, fonction, entités) pour réduire la validation.',
  },
  {
    label: "Lisez le bilan d'ingestion",
    detail:
      "Après l'ingestion, le système affiche un bilan. Plus vous avez fourni de hints, plus de métadonnées sont auto-validées.",
  },
  {
    label: 'Validez les fragments candidats',
    detail:
      'Tab Harvest — pour les fragments "tout vert", validation rapide. Pour ceux avec warnings, lecture attentive.',
  },
  {
    label: 'Validez les métadonnées émergentes',
    detail:
      'Metadata > À valider — approuvez, fusionnez avec des existants ou rejetez les nouvelles propositions du LLM.',
  },
  {
    label: 'Traitez les détections automatiques',
    detail:
      'Remplacements, Relations, Contradictions — traitez les détections liées à votre ingestion.',
  },
  {
    label: 'Vérifiez en composition',
    detail:
      'Créez un document de test dans la vue Composition et vérifiez que les fragments validés apparaissent dans les recommandations.',
  },
];

const METADATA_GLOSSARY = [
  {
    field: 'Domaine',
    code: 'domain',
    question: 'De quel produit Linagora parle ce fragment ?',
    values:
      'twake-mail · twake-calendar · twake-drive · twake-chat · linshare · lincloud · linto · openrag · linagora-corp · other',
    example: 'twake-mail → fragment sur la messagerie collaborative Apache James / JMAP',
  },
  {
    field: 'Type rhétorique',
    code: 'type',
    question: 'Quelle est la nature du contenu ?',
    values:
      'argument · description · pricing · clause · faq · introduction · conclusion · temoignage · reference-technique · cas-usage · methodology · engagement · bio',
    example: 'argument → "Open source réel, sans dual licensing"',
  },
  {
    field: 'Tags',
    code: 'tags',
    question: 'Quels concepts transverses ce fragment illustre-t-il ?',
    values: 'Libres — proposés par le LLM, validés dans Metadata > À valider',
    example: 'open-source · sovereignty · on-premise · cloud-native',
  },
  {
    field: 'Entités',
    code: 'entities',
    question: 'Quels acteurs réels sont mentionnés dans ce fragment ?',
    values:
      'clients · products · technologies · partners · certifications · regulations — référentiel validé',
    example: 'SecNumCloud (certification) · CNB (client) · Apache James (technology)',
  },
  {
    field: 'Statut workflow',
    code: 'quality',
    question: 'Où en est ce fragment dans son cycle de validation ?',
    values:
      'draft (extrait, non vérifié) · reviewed (vérifié par un humain) · approved (validé, utilisable en composition)',
    example: 'approved → apparaît dans les recommandations de composition et le Knowledge Graph',
  },
];

const FAQ = [
  {
    q: 'Pourquoi deux phases de validation ?',
    a: 'D\'abord la validation "par lot" dans Harvest (fragments candidats). Ensuite la validation des métadonnées dans Metadata. Cette séparation permet de valider rapidement le contenu, puis d\'affiner la classification indépendamment.',
  },
  {
    q: 'Que signifient les badges "Doublon" et "Quasi-doublon" ?',
    a: 'À chaque ingestion, le système compare les nouveaux fragments à la base existante. Doublon (exact) → probablement à rejeter. Quasi-doublon (>90% similaire) → vérifier les nuances avant validation.',
  },
  {
    q: "C'est quoi un trust_source ?",
    a: "Chaque métadonnée a une source : human-direct (posée par un humain, trust max), llm-confirmed (LLM a confirmé un hint fourni à l'upload), llm-deviation (LLM a dévié d'un hint, mérite attention), llm-inferred (inféré sans hint, passe en queue admin). Plus vous fournissez de hints, moins de travail de validation.",
  },
  {
    q: 'Quand rejeter vs renommer une proposition ?',
    a: 'Rejeter : la proposition est fausse ou inutile. Renommer : la proposition est correcte mais avec une variation orthographique (ex: "twakemail" → "twake-mail"). Fusionner : la proposition existe déjà sous une autre forme.',
  },
  {
    q: 'Que se passe-t-il si je rejette par erreur ?',
    a: 'Dans Metadata > Référentiel, activez le toggle "Afficher les rejetés". Les items rejetés apparaissent avec un bouton "Restaurer".',
  },
];

export function AdminHomePage() {
  const available = TABS.filter((t) => t.available);
  const coming = TABS.filter((t) => !t.available);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-10">
      {/* Section 1 — Vue d'ensemble */}
      <section>
        <h1 className="text-2xl font-bold mb-2">Console d'administration</h1>
        <p className="text-muted-foreground leading-relaxed max-w-2xl">
          Fragmint assemble des documents par recomposition de fragments versionnés. Cette console
          permet de maintenir la qualité du corpus : valider les métadonnées proposées par l'IA,
          gérer les remplacements de contenu obsolète, résoudre les contradictions et superviser
          l'évolution du référentiel.
        </p>
      </section>

      {/* Section 2 — Workflow */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Comment ça marche ?</h2>
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-5">
          {/* Circles + connecting line */}
          <div className="relative flex items-center justify-between mb-4">
            <div className="absolute left-0 right-0 top-3.5 h-0.5 bg-blue-200 dark:bg-blue-700 -z-0" />
            {WORKFLOW_STEPS.map((s) => (
              <div key={s.step} className="relative z-10 flex flex-col items-center gap-1 flex-1">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold ring-2 ring-blue-50 dark:ring-blue-950">
                  {s.step}
                </div>
              </div>
            ))}
          </div>
          {/* Labels below */}
          <div className="flex items-start justify-between">
            {WORKFLOW_STEPS.map((s) => (
              <div key={s.step} className="flex flex-col items-center flex-1 px-1 text-center">
                <p className="text-xs font-semibold leading-tight">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-1 leading-tight">{s.detail}</p>
                <span className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                  {s.tab}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-4 border-t border-blue-200 dark:border-blue-800 pt-3">
            Plus vos validations sont précises au début, plus le système devient autonome ensuite.
            La qualité du référentiel détermine la qualité des compositions futures.
          </p>
        </div>
      </section>

      {/* Section 3 — Cartes des tabs */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Les tabs en détail</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {available.map((tab) => (
            <TabCardItem key={tab.title} tab={tab} />
          ))}
        </div>
        {coming.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
              Bientôt disponible
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 opacity-50">
              {coming.map((tab) => (
                <TabCardItem key={tab.title} tab={tab} disabled />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Section 4 — Quick start */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <CheckSquare className="h-5 w-5" />
          Première fois ici ? Suivez ce parcours
        </h2>
        <div className="space-y-2">
          {QUICK_START.map((item, i) => (
            <div
              key={i}
              className="flex gap-3 p-3 rounded-lg border bg-card hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-muted-foreground text-xs font-bold shrink-0 mt-0.5">
                {i + 1}
              </div>
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Section 5 — Glossaire des métadonnées */}
      <section>
        <h2 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Glossaire des métadonnées
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          Chaque fragment porte ces 8 axes de classification. Comprendre leur rôle permet de valider
          et corriger plus vite.
        </p>
        <div className="space-y-2">
          {METADATA_GLOSSARY.map((item) => (
            <details key={item.code} className="group border rounded-lg">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer select-none list-none hover:bg-muted/40 rounded-lg transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium">{item.field}</span>
                  <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                    {item.code}
                  </code>
                </div>
                <span className="text-muted-foreground group-open:rotate-180 transition-transform text-xs">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-3 pt-1 border-t space-y-2">
                <p className="text-sm font-medium text-foreground">❓ {item.question}</p>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Valeurs
                  </p>
                  <p className="text-xs text-muted-foreground">{item.values}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-1">
                    Exemple
                  </p>
                  <p className="text-xs text-muted-foreground italic">{item.example}</p>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      {/* Section 6 — FAQ */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Questions fréquentes</h2>
        <div className="space-y-2">
          {FAQ.map((item, i) => (
            <details key={i} className="group border rounded-lg">
              <summary className="flex items-center justify-between px-4 py-3 cursor-pointer text-sm font-medium select-none list-none hover:bg-muted/40 rounded-lg transition-colors">
                {item.q}
                <span className="text-muted-foreground group-open:rotate-180 transition-transform text-xs">
                  ▼
                </span>
              </summary>
              <p className="px-4 pb-3 pt-1 text-sm text-muted-foreground leading-relaxed border-t">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

function TabCardItem({ tab, disabled }: { tab: TabCard; disabled?: boolean }) {
  const Icon = tab.icon;
  return (
    <div
      className={cn(
        'border rounded-lg p-4 flex flex-col gap-3',
        !disabled && 'hover:shadow-sm transition-shadow bg-card',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-md bg-muted shrink-0">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold text-sm">{tab.title}</h3>
          <p className="text-xs text-muted-foreground">{tab.subtitle}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed flex-1">{tab.description}</p>
      {!disabled ? (
        <Link
          to={tab.link}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {tab.cta} <ArrowRight className="h-3 w-3" />
        </Link>
      ) : (
        <span className="text-xs text-muted-foreground">Bientôt disponible</span>
      )}
    </div>
  );
}
