/**
 * Default Linagora product domains.
 * Inserted on first run; existing rows are skipped (INSERT OR IGNORE).
 * created_at is required (NOT NULL) in fragment_domains.
 */
export const LINAGORA_DOMAINS = [
  {
    slug: 'twake-workplace',
    label: 'Twake Workplace',
    description: 'Suite collaborative open source (messagerie, visioconférence, documents)',
  },
  {
    slug: 'twake-mail',
    label: 'Twake Mail',
    description: 'Webmail open source basé sur OpenPaaS',
  },
  {
    slug: 'linshare',
    label: 'LinShare',
    description: 'Partage de fichiers sécurisé pour entreprises',
  },
  {
    slug: 'linid',
    label: 'LinID',
    description: 'Gestion des identités et annuaires LDAP/AD',
  },
  {
    slug: 'linagora-openpaas',
    label: 'OpenPaaS',
    description: 'Plateforme de communication unifiée open source',
  },
  {
    slug: 'tmail',
    label: 'TMail',
    description: 'Serveur email open source basé sur Apache James',
  },
  {
    slug: 'linsign',
    label: 'LinSign',
    description: "Signature électronique et gestion de documents légaux",
  },
  {
    slug: 'linchat',
    label: 'LinChat',
    description: "Messagerie instantanée d'entreprise",
  },
  {
    slug: 'linum',
    label: 'LinUM',
    description: 'Gestion unifiée des utilisateurs et des accès',
  },
  {
    slug: 'linagora-ia',
    label: 'Linagora IA',
    description: "Services d'intelligence artificielle souveraine",
  },
  {
    slug: 'opencloud',
    label: 'OpenCloud',
    description: 'Infrastructure cloud souveraine',
  },
  {
    slug: 'james',
    label: 'Apache James',
    description: 'Serveur de messagerie Java open source',
  },
  {
    slug: 'obm',
    label: 'OBM',
    description: 'Groupware open source (calendrier, contacts, messagerie)',
  },
  {
    slug: 'other',
    label: 'Autre',
    description: 'Domaine non catégorisé',
  },
  {
    slug: 'linagora-general',
    label: 'Linagora (général)',
    description: 'Contenu institutionnel Linagora non lié à un produit spécifique',
  },
] as const;
