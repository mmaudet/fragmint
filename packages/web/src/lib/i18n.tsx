import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'fr' | 'en';

const translations = {
  common: {
    search: { fr: 'Rechercher...', en: 'Search...' },
    approve: { fr: 'Approuver', en: 'Approve' },
    loading: { fr: 'Chargement...', en: 'Loading...' },
    inProgress: { fr: 'En cours...', en: 'In progress...' },
    error: { fr: 'Erreur', en: 'Error' },
    previous: { fr: 'Précédent', en: 'Previous' },
    next: { fr: 'Suivant', en: 'Next' },
    page: { fr: 'Page', en: 'Page' },
    content: { fr: 'Contenu', en: 'Content' },
    metadata: { fr: 'Métadonnées', en: 'Metadata' },
    tags: { fr: 'Tags', en: 'Tags' },
    history: { fr: 'Historique', en: 'History' },
    noTitle: { fr: 'Sans titre', en: 'Untitled' },
    notFound: { fr: 'Fragment introuvable.', en: 'Fragment not found.' },
    domain: { fr: 'Domaine', en: 'Domain' },
    type: { fr: 'Type', en: 'Type' },
    language: { fr: 'Langue', en: 'Language' },
    author: { fr: 'Auteur', en: 'Author' },
    createdAt: { fr: 'Créé le', en: 'Created' },
    updatedAt: { fr: 'Mis à jour', en: 'Updated' },
    uses: { fr: 'Utilisations', en: 'Uses' },
    file: { fr: 'Fichier', en: 'File' },
    download: { fr: 'Télécharger', en: 'Download' },
  },
  login: {
    title: { fr: 'Fragmint', en: 'Fragmint' },
    username: { fr: "Nom d'utilisateur", en: 'Username' },
    password: { fr: 'Mot de passe', en: 'Password' },
    connecting: { fr: 'Connexion...', en: 'Signing in...' },
    signIn: { fr: 'Se connecter', en: 'Sign in' },
    loginFailed: { fr: 'Échec de connexion', en: 'Login failed' },
  },
  nav: {
    library: { fr: 'Bibliothèque', en: 'Library' },
    inventory: { fr: 'Inventaire', en: 'Inventory' },
    composer: { fr: 'Compositeur', en: 'Composer' },
    validation: { fr: 'Validation', en: 'Validation' },
    logout: { fr: 'Déconnexion', en: 'Logout' },
  },
  fragments: {
    title: { fr: 'Bibliothèque', en: 'Library' },
    searchPlaceholder: { fr: 'Rechercher un fragment...', en: 'Search a fragment...' },
    allTypes: { fr: 'Tous les types', en: 'All types' },
    allQualities: { fr: 'Toutes qualités', en: 'All qualities' },
    allLanguages: { fr: 'Toutes langues', en: 'All languages' },
    allDomains: { fr: 'Tous domaines', en: 'All domains' },
    typePlaceholder: { fr: 'Type', en: 'Type' },
    qualityPlaceholder: { fr: 'Qualité', en: 'Quality' },
    languagePlaceholder: { fr: 'Langue', en: 'Language' },
    domainPlaceholder: { fr: 'Domaine', en: 'Domain' },
    noFragments: { fr: 'Aucun fragment trouvé', en: 'No fragments found' },
    markReviewed: { fr: 'Marquer reviewed', en: 'Mark as reviewed' },
    reviewSuccess: { fr: 'Fragment marqué comme reviewed', en: 'Fragment marked as reviewed' },
    reviewError: { fr: 'Erreur lors du review', en: 'Error during review' },
    approveSuccess: { fr: 'Fragment approuvé', en: 'Fragment approved' },
    approveError: { fr: "Erreur lors de l'approbation", en: 'Error during approval' },
  },
  inventory: {
    title: { fr: 'Inventaire', en: 'Inventory' },
    loadError: { fr: "Erreur lors du chargement de l'inventaire", en: 'Error loading inventory' },
    totalFragments: { fr: 'Total fragments', en: 'Total fragments' },
    coverageByDomain: { fr: 'Couverture par domaine', en: 'Coverage by domain' },
    allLanguages: { fr: 'Toutes langues', en: 'All languages' },
    detectedGaps: { fr: 'Lacunes détectées', en: 'Detected gaps' },
    noGaps: { fr: 'Aucune lacune détectée.', en: 'No gaps detected.' },
    status: { fr: 'Statut', en: 'Status' },
  },
  compose: {
    title: { fr: 'Compositeur', en: 'Composer' },
    templateChoice: { fr: 'Choix du template', en: 'Template selection' },
    templatePlaceholder: { fr: 'Choisir un template...', en: 'Choose a template...' },
    context: { fr: 'Contexte', en: 'Context' },
    contextDescription: { fr: 'Renseignez les variables de contexte pour la composition', en: 'Fill in the context variables for composition' },
    choosePlaceholder: { fr: 'Choisir', en: 'Choose' },
    templateSlots: { fr: 'Slots du template', en: 'Template slots' },
    resolvedFragments: { fr: 'Fragments résolus pour chaque slot', en: 'Resolved fragments for each slot' },
    composing: { fr: 'Composition en cours...', en: 'Composing...' },
    composeDocument: { fr: 'Composer le document', en: 'Compose document' },
    allSlotsRequired: { fr: 'Tous les slots requis doivent avoir au moins un fragment.', en: 'All required slots must have at least one fragment.' },
    compositionComplete: { fr: 'Composition terminée', en: 'Composition complete' },
    resolvedFragmentsLabel: { fr: 'Fragments résolus', en: 'Resolved fragments' },
    skippedSlots: { fr: 'Slots ignorés', en: 'Skipped slots' },
    warnings: { fr: 'Avertissements', en: 'Warnings' },
  },
  validation: {
    title: { fr: 'Validation', en: 'Validation' },
    pendingApproval: { fr: "Fragments en attente d'approbation", en: 'Fragments pending approval' },
    noFragmentsPending: { fr: 'Aucun fragment en attente de validation', en: 'No fragments pending validation' },
    gitHistory: { fr: 'Historique Git', en: 'Git history' },
    read: { fr: 'Lire', en: 'Read' },
    requestChange: { fr: 'Demander modification', en: 'Request change' },
    changeRequested: { fr: 'Demande de modification envoyée', en: 'Change request sent' },
    approveSuccess: { fr: 'Fragment approuvé', en: 'Fragment approved' },
    approveError: { fr: "Erreur lors de l'approbation", en: 'Error during approval' },
  },
} as const;

type Translations = typeof translations;
type Section = keyof Translations;
type Key<S extends Section> = keyof Translations[S];

interface I18nContextType {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: <S extends Section>(section: S, key: Key<S>) => string;
}

const I18nContext = createContext<I18nContextType | null>(null);

const STORAGE_KEY = 'fragmint-lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' ? 'en' : 'fr';
  });

  const setLang = useCallback((newLang: Lang) => {
    setLangState(newLang);
    localStorage.setItem(STORAGE_KEY, newLang);
  }, []);

  const t = useCallback(
    <S extends Section>(section: S, key: Key<S>): string => {
      const entry = (translations as any)[section]?.[key];
      if (!entry) return `${String(section)}.${String(key)}`;
      return entry[lang] as string;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
