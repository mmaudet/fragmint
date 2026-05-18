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
    save: { fr: 'Enregistrer', en: 'Save' },
    cancel: { fr: 'Annuler', en: 'Cancel' },
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
    validFrom: { fr: 'Valide depuis', en: 'Valid from' },
    validUntil: { fr: "Valide jusqu'au", en: 'Valid until' },
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
    home: { fr: 'Accueil', en: 'Home' },
    library: { fr: 'Bibliothèque', en: 'Library' },
    inventory: { fr: 'Inventaire', en: 'Inventory' },
    composer: { fr: 'Compositeur', en: 'Composer' },
    validation: { fr: 'Validation', en: 'Validation' },
    harvest: { fr: 'Ingestion', en: 'Ingestion' },
    planGeneration: { fr: 'Plan', en: 'Plan' },
    logout: { fr: 'Déconnexion', en: 'Logout' },
  },
  home: {
    tagline: { fr: 'Outil de production documentaire assisté par IA', en: 'AI-assisted document production tool' },
    subtitle: {
      fr: "Vos équipes passent des heures à reconstruire propositions, rapports et contrats en copiant des paragraphes d'anciens fichiers. Fragmint centralise vos meilleurs blocs de contenu — arguments, clauses, tarifs — les certifie par validation humaine, et les réassemble pour générer de nouveaux documents.",
      en: "Your teams spend hours rebuilding proposals, reports and contracts by copying paragraphs from old files. Fragmint centralises your best content blocks — arguments, clauses, pricing — certifies them through human validation, and reassembles them to generate new documents.",
    },
    howItWorks: { fr: 'Comment ça marche ?', en: 'How does it work?' },
    step1Title: { fr: 'Ingérer', en: 'Ingest' },
    step1Desc: { fr: "Importez vos documents existants. Fragmint les découpe automatiquement en blocs réutilisables et les classe par type et domaine.", en: 'Import your existing documents. Fragmint automatically splits them into reusable blocks and classifies them by type and domain.' },
    step1Cta: { fr: "Aller à l'ingestion", en: 'Go to ingestion' },
    step2Title: { fr: 'Valider', en: 'Validate' },
    step2Desc: { fr: 'Vérifiez les fragments générés, acceptez ou rejetez chaque candidat. Les fragments approuvés constituent votre bibliothèque certifiée.', en: 'Check generated fragments, accept or reject each candidate. Approved fragments make up your certified library.' },
    step2Cta: { fr: 'Aller à la validation', en: 'Go to validation' },
    step3Title: { fr: 'Générer', en: 'Generate' },
    step3Desc: { fr: 'Décrivez le document à produire. Fragmint sélectionne les fragments pertinents dans la bibliothèque et rédige le contenu section par section.', en: 'Describe the document to produce. Fragmint selects relevant fragments from the library and drafts content section by section.' },
    step3Cta: { fr: 'Créer un plan', en: 'Create a plan' },
    statFragments: { fr: 'fragments certifiés', en: 'certified fragments' },
    statApproved: { fr: 'approuvés', en: 'approved' },
    statPending: { fr: 'à valider', en: 'pending validation' },
    statPlans: { fr: 'plans générés', en: 'generated plans' },
    collectionsTitle: { fr: 'Collections', en: 'Collections' },
    collectionsDesc: {
      fr: "Vos contenus sont organisés en collections. common est la bibliothèque partagée par toute l'organisation. Vous pouvez créer des collections privées par équipe ou projet, avec des droits d'accès distincts (lecteur, contributeur, expert, admin). La composition peut puiser dans plusieurs collections à la fois.",
      en: "Your contents are organised in collections. common is the library shared across the organisation. You can create private collections per team or project, with distinct access rights (reader, contributor, expert, admin). Composition can draw from multiple collections at once.",
    },
  },
  quality: {
    draft: { fr: 'Brouillon', en: 'Draft' },
    reviewed: { fr: 'Vérifié', en: 'Reviewed' },
    approved: { fr: 'Approuvé', en: 'Approved' },
    deprecated: { fr: 'Obsolète', en: 'Deprecated' },
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
    markReviewed: { fr: 'Marquer comme vérifié', en: 'Mark as reviewed' },
    reviewSuccess: { fr: 'Fragment marqué comme vérifié', en: 'Fragment marked as reviewed' },
    reviewError: { fr: 'Erreur lors de la vérification', en: 'Error during review' },
    approveSuccess: { fr: 'Fragment approuvé', en: 'Fragment approved' },
    approveError: { fr: "Erreur lors de l'approbation", en: 'Error during approval' },
    updateSuccess: { fr: 'Fragment mis à jour', en: 'Fragment updated' },
    updateError: { fr: 'Erreur lors de la mise à jour', en: 'Error updating fragment' },
    permissionDenied: { fr: 'Droits insuffisants pour modifier ce fragment', en: 'Insufficient rights to edit this fragment' },
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
    contextDescription: {
      fr: 'Renseignez les variables de contexte pour la composition',
      en: 'Fill in the context variables for composition',
    },
    choosePlaceholder: { fr: 'Choisir', en: 'Choose' },
    templateSlots: { fr: 'Slots du template', en: 'Template slots' },
    resolvedFragments: {
      fr: 'Fragments résolus pour chaque slot',
      en: 'Resolved fragments for each slot',
    },
    composing: { fr: 'Composition en cours...', en: 'Composing...' },
    composeDocument: { fr: 'Composer le document', en: 'Compose document' },
    allSlotsRequired: {
      fr: 'Tous les slots requis doivent avoir au moins un fragment.',
      en: 'All required slots must have at least one fragment.',
    },
    compositionComplete: { fr: 'Composition terminée', en: 'Composition complete' },
    resolvedFragmentsLabel: { fr: 'Fragments résolus', en: 'Resolved fragments' },
    skippedSlots: { fr: 'Slots ignorés', en: 'Skipped slots' },
    warnings: { fr: 'Avertissements', en: 'Warnings' },
    structuredData: { fr: 'Données tabulaires', en: 'Tabular data' },
    structuredDataDescription: {
      fr: 'Renseignez les lignes de données utilisées dans le template',
      en: 'Fill in the data rows used in the template',
    },
  },
  validation: {
    title: { fr: 'Validation', en: 'Validation' },
    pendingReview: { fr: 'À vérifier', en: 'Pending review' },
    pendingApproval: { fr: "En attente d'approbation", en: 'Pending approval' },
    noFragmentsPending: {
      fr: 'Aucun fragment en attente de validation',
      en: 'No fragments pending validation',
    },
    gitHistory: { fr: 'Historique Git', en: 'Git history' },
    read: { fr: 'Lire', en: 'Read' },
    requestChange: { fr: 'Demander modification', en: 'Request change' },
    changeRequested: { fr: 'Demande de modification envoyée', en: 'Change request sent' },
    approveSuccess: { fr: 'Fragment approuvé', en: 'Fragment approved' },
    approveError: { fr: "Erreur lors de l'approbation", en: 'Error during approval' },
  },
  harvest: {
    title: { fr: 'Ingestion', en: 'Ingestion' },
    uploadTitle: { fr: 'Importer des documents', en: 'Import documents' },
    dropzone: {
      fr: 'Glisser des fichiers ici ou cliquer pour sélectionner',
      en: 'Drop files here or click to select',
    },
    formats: { fr: '.docx supporté', en: '.docx supported' },
    confidence: { fr: 'Confiance minimum', en: 'Minimum confidence' },
    analyze: { fr: 'Analyser les documents', en: 'Analyze documents' },
    analyzing: { fr: 'Analyse en cours...', en: 'Analyzing...' },
    total: { fr: 'Total candidats', en: 'Total candidates' },
    duplicates: { fr: 'Doublons', en: 'Duplicates' },
    lowConfidence: { fr: 'Faible confiance', en: 'Low confidence' },
    valid: { fr: 'Valides', en: 'Valid' },
    acceptAll: { fr: 'Tout accepter', en: 'Accept all' },
    rejectAll: { fr: 'Tout rejeter', en: 'Reject all' },
    commit: { fr: 'Commiter les acceptés', en: 'Commit accepted' },
    committed: { fr: 'fragments committés en draft', en: 'fragments committed as draft' },
    goToValidation: { fr: 'Aller à la Validation', en: 'Go to Validation' },
    duplicateWarning: { fr: 'doublon probable', en: 'probable duplicate' },
    accept: { fr: 'Accepter', en: 'Accept' },
    reject: { fr: 'Rejeter', en: 'Reject' },
    error: { fr: "Erreur lors de l'analyse", en: 'Error during analysis' },
  },
  planGeneration: {
    title: { fr: 'Génération de plan', en: 'Plan generation' },
    newPlan: { fr: 'Nouveau plan', en: 'New plan' },
    specPrompt: { fr: 'Spécification', en: 'Specification' },
    filters: { fr: 'Filtres', en: 'Filters' },
    generatePlan: { fr: 'Générer le plan', en: 'Generate plan' },
    regeneratePlan: { fr: 'Régénérer', en: 'Regenerate' },
    refinementInstructions: { fr: 'Instructions complémentaires', en: 'Refinement instructions' },
    validatePlan: { fr: 'Valider le plan', en: 'Validate plan' },
    validateAllSections: { fr: 'Valider toutes les sections', en: 'Validate all sections' },
    generateSection: { fr: 'Générer le draft', en: 'Generate section' },
    generateAllSections: { fr: 'Générer tous les drafts', en: 'Generate all section drafts' },
    regenerateAllSections: { fr: 'Régénérer tous les drafts', en: 'Regenerate all section drafts' },
    assemble: { fr: 'Assembler le document', en: 'Assemble document' },
    generateAllSectionsHint: {
      fr: "Écrit le brouillon de chaque section à partir des fragments sélectionnés.",
      en: "Writes each section's draft from the selected fragments.",
    },
    assembleHint: {
      fr: "Concatène tous les drafts en un document Markdown final, prêt à exporter.",
      en: "Concatenates all drafts into a final Markdown document, ready to export.",
    },
    assembleSuccess: {
      fr: "Document assemblé — passez à l'étape Assemblage pour exporter.",
      en: "Document assembled — go to the Assembly step to export.",
    },
    assembleError: {
      fr: "Assemblage échoué",
      en: "Assembly failed",
    },
    downloadMd: { fr: 'Télécharger .md', en: 'Download .md' },
    downloadDocx: { fr: 'Télécharger .docx', en: 'Download .docx' },
    assembleFirst: { fr: 'Assemblez d\'abord le document', en: 'Assemble the document first' },
    styleTemplate: { fr: 'Modèle de style', en: 'Style template' },
    defaultStyling: { fr: '(style par défaut)', en: '(default styling)' },
    uploadStyleTemplate: { fr: 'Importer un nouveau modèle', en: 'Upload new template' },
    approve: { fr: 'Approuver', en: 'Approve' },
    reject: { fr: 'Rejeter', en: 'Reject' },
    edit: { fr: 'Éditer', en: 'Edit' },
    useLocally: { fr: 'Utiliser localement', en: 'Use locally' },
    proposeToLibrary: { fr: 'Proposer à la bibliothèque', en: 'Propose to library' },
    reSearch: { fr: 'Rechercher de nouveau', en: 'Search again' },
    noCandidates: {
      fr: 'Aucun fragment trouvé pour cette section. Cliquez sur « Re-rechercher » pour relancer la recherche.',
      en: 'No fragments found for this section. Click "Re-search" to run the search again.',
    },
    matchStrong: { fr: 'pertinence forte', en: 'strong match' },
    matchMedium: { fr: 'pertinence moyenne', en: 'medium match' },
    matchWeak: { fr: 'pertinence faible', en: 'weak match' },
    addFragment: { fr: 'Ajouter un fragment', en: 'Add a fragment' },
    addFromLibrary: { fr: 'Depuis la bibliothèque', en: 'From library' },
    addManually: { fr: 'Manuel', en: 'Manual' },
    libraryQueryPlaceholder: {
      fr: 'Rechercher dans la bibliothèque…',
      en: 'Search the library…',
    },
    libraryQueryHint: {
      fr: 'Tapez quelques mots pour chercher un fragment existant.',
      en: 'Type a few words to search for an existing fragment.',
    },
    librarySearchEmpty: { fr: 'Aucun résultat.', en: 'No results.' },
    manualBodyPlaceholder: {
      fr: 'Tapez le contenu du fragment…',
      en: 'Type the fragment content…',
    },
    manualBodyRequired: {
      fr: 'Le contenu du fragment est requis.',
      en: 'Fragment content is required.',
    },
    addAndSelect: { fr: 'Créer et sélectionner', en: 'Create and select' },
    fragmentAdded: { fr: 'Fragment ajouté à la section.', en: 'Fragment added to the section.' },
    addFragmentError: { fr: "Échec de l'ajout du fragment", en: 'Failed to add fragment' },
    step1Label: { fr: 'Specs', en: 'Specs' },
    step2Label: { fr: 'Fragments', en: 'Fragments' },
    step3Label: { fr: 'Section drafts', en: 'Section drafts' },
    step4Label: { fr: 'Assemblage', en: 'Assembly' },
    step1Help: {
      fr: "Décrivez l'objectif du document à produire et générez un plan structuré en sections. Ajustez le plan markdown puis cliquez sur « Valider le plan » pour passer à l'étape suivante.",
      en: 'Describe the document you want to produce and generate a structured plan. Adjust the markdown plan, then click "Validate plan" to move on.',
    },
    step2Help: {
      fr: "Pour chaque section du plan, choisissez les fragments à utiliser. Cliquez « Approuver » pour valider un candidat proposé, ou utilisez « Ajouter un fragment » pour en sélectionner un depuis la bibliothèque ou en créer un manuellement.",
      en: 'For each section, pick the fragments to use. Click "Approve" to validate a suggested candidate, or use "Add a fragment" to pick one from the library or create one manually.',
    },
    step3Help: {
      fr: "Générez le brouillon de chaque section à partir des fragments sélectionnés. Vous pouvez générer toutes les sections d'un coup ou les éditer individuellement.",
      en: 'Generate the draft of each section from the selected fragments. Generate all at once or edit each section individually.',
    },
    step4Help: {
      fr: "Assemblez le document final, choisissez un modèle de style et téléchargez le résultat en .md ou .docx.",
      en: 'Assemble the final document, choose a style template, and download it as .md or .docx.',
    },
    helpClose: { fr: 'Masquer cette aide', en: 'Hide this help' },
    stepLocked: {
      fr: 'Terminez l’étape précédente pour débloquer celle-ci.',
      en: 'Finish the previous step to unlock this one.',
    },
    deleteConfirmPrompt: {
      fr: 'Supprimer ce plan ? Cette action est irréversible.',
      en: 'Delete this plan? This action cannot be undone.',
    },
    confirmDelete: { fr: 'Oui, supprimer', en: 'Yes, delete' },
    cancel: { fr: 'Annuler', en: 'Cancel' },
    deleteError: {
      fr: 'Échec de la suppression du plan',
      en: 'Failed to delete plan',
    },
    regenerate: { fr: 'Régénérer', en: 'Regenerate' },
    filterDomain: { fr: 'Domaines', en: 'Domains' },
    filterDomainTooltip: {
      fr: "Sujet du fragment (ex. twake, lincloud, linagora). Séparer par des virgules pour inclure plusieurs domaines.",
      en: "Fragment subject matter (e.g. twake, lincloud, linagora). Separate with commas to include multiple domains.",
    },
    filterLang: { fr: 'Langue', en: 'Language' },
    filterLangTooltip: {
      fr: "Code ISO de la langue (ex. fr, en). Laissez vide pour toutes les langues.",
      en: "ISO language code (e.g. fr, en). Leave empty for all languages.",
    },
    filterType: { fr: 'Type', en: 'Type' },
    filterTypeTooltip: {
      fr: "Nature du contenu du fragment (ex. introduction, argument, pricing). Laissez vide pour laisser le système inférer automatiquement le type adapté à chaque section.",
      en: "Fragment content type (e.g. introduction, argument, pricing). Leave empty to let the system automatically infer the right type per section.",
    },
    filterTags: { fr: 'Tags', en: 'Tags' },
    filterTagsTooltip: {
      fr: "Mots-clés libres pour affiner la recherche (ex. produit:Twake). Séparer par des virgules.",
      en: "Free-form keywords to narrow the search (e.g. produit:Twake). Separate with commas.",
    },
    writerOverride: { fr: 'Instructions globales au rédacteur', en: 'Global writer instructions' },
    writerOverrideTooltip: {
      fr: "Ces instructions s'appliquent à toutes les sections. Elles sont remplacées si une section a ses propres instructions.",
      en: 'These instructions apply to all sections. They are overridden if a section has its own instructions.',
    },
    writerOverridePlaceholder: {
      fr: 'Ex. : Adopte un ton formel et concis. Évite le jargon technique.',
      en: 'E.g.: Use a formal and concise tone. Avoid technical jargon.',
    },
    sectionInstructions: { fr: 'Instructions spécifiques à cette section', en: 'Section-specific instructions' },
    sectionInstructionsTooltip: {
      fr: 'Optionnel. Si renseigné, remplace les instructions globales uniquement pour cette section.',
      en: 'Optional. If set, overrides the global instructions for this section only.',
    },
    sectionInstructionsPlaceholder: {
      fr: 'Ex. : Commence par un résumé en 2 phrases.',
      en: 'E.g.: Start with a 2-sentence summary.',
    },
  },
  collections: {
    select: { fr: 'Collection', en: 'Collection' },
    common: { fr: 'Commune', en: 'Common' },
    personal: { fr: 'Personnelle', en: 'Personal' },
    team: { fr: '\u00c9quipe', en: 'Team' },
    readOnly: { fr: 'Lecture seule', en: 'Read only' },
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

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
