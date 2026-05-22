// Default seed taxonomy — merged with existing DB domains/types at harvest time.
// Admins can extend the taxonomy by adding fragments with custom domains/types via API.
// Domain = the SUBJECT MATTER (product / thematic area).
// Content nature (technical, commercial, legal…) goes in tags, not domain.
export interface DomainDef {
  slug: string;
  description: string;
}

export const HARVESTER_DOMAINS: DomainDef[] = [
  {
    slug: 'twake',
    description:
      'Twake Workplace — messaging, visio, collaborative drive, tasks. Use only when the text explicitly discusses Twake features or proposes Twake as a solution.',
  },
  {
    slug: 'lincloud',
    description:
      'LinCloud / LinShare cloud suite. Use only when the text explicitly discusses LinCloud hosting or the LinShare suite.',
  },
  {
    slug: 'linshare',
    description:
      'LinShare file sharing (standalone). Use only when the text is specifically about LinShare.',
  },
  {
    slug: 'linagora',
    description:
      'Linagora company — ONLY for content explicitly about Linagora itself: company presentation, methodology, values, history. NOT for generic SLA, technical specs, or client requirements.',
  },
  {
    slug: 'other',
    description:
      'Generic or client-specific content: SLA definitions, procurement requirements, legal clauses, technical specs not tied to a specific product. When in doubt, use other.',
  },
];

// ---- Functions ----
export interface FunctionDef {
  slug: string;
  label: string;
  description: string;
}

export const HARVESTER_FUNCTIONS: FunctionDef[] = [
  {
    slug: 'technical',
    label: 'Technical',
    description: 'Architecture, deployment, integration, technical specifications',
  },
  {
    slug: 'commercial',
    label: 'Commercial',
    description: 'Offers, pricing, value proposition, competitive positioning',
  },
  {
    slug: 'legal',
    label: 'Legal',
    description: 'Contractual clauses, compliance, regulatory requirements',
  },
  {
    slug: 'operational',
    label: 'Operational',
    description: 'Support, SLA, maintenance procedures, operations',
  },
  {
    slug: 'strategic',
    label: 'Strategic',
    description: 'Vision, market positioning, roadmap, partnerships',
  },
  {
    slug: 'reference',
    label: 'Reference',
    description: 'Client testimonials, case studies, concrete use cases',
  },
];

// ---- Granular domain slugs (product-level) ----
export const HARVESTER_DOMAINS_GRANULAR = [
  {
    slug: 'twake-mail',
    label: 'Twake Mail',
    description:
      'Twake Mail — email, JMAP, Apache James. Use when text explicitly discusses Twake Mail.',
  },
  {
    slug: 'twake-calendar',
    label: 'Twake Calendar',
    description:
      'Twake Calendar — scheduling, CalDAV. Use when text explicitly discusses Twake Calendar.',
  },
  {
    slug: 'twake-drive',
    label: 'Twake Drive',
    description: 'Twake Drive — file sharing, collaborative storage.',
  },
  {
    slug: 'twake-chat',
    label: 'Twake Chat',
    description: 'Twake Chat — instant messaging, Matrix protocol.',
  },
  {
    slug: 'linshare',
    label: 'LinShare',
    description: 'LinShare — secure file transfer. Use when text explicitly discusses LinShare.',
  },
  {
    slug: 'lincloud',
    label: 'LinCloud',
    description:
      'LinCloud — sovereign cloud platform. Use when text explicitly discusses LinCloud.',
  },
  { slug: 'linto', label: 'LinTO', description: 'LinTO — voice assistant, AI.' },
  { slug: 'openrag', label: 'OpenRAG', description: 'OpenRAG — retrieval-augmented generation.' },
  {
    slug: 'linagora-corp',
    label: 'Linagora (company)',
    description:
      'Linagora as a company — history, values, methodology. NOT for generic SLA or tech specs.',
  },
  {
    slug: 'other',
    label: 'Other',
    description:
      'Client-specific content, SLA, procurement, regulatory content not tied to a specific product.',
  },
];

// ---- Entities ----
export interface EntityDef {
  type: 'client' | 'product' | 'technology' | 'partner' | 'certification' | 'regulation' | 'metric';
  canonicalName: string;
  aliases: string[];
}

export const INITIAL_ENTITIES: EntityDef[] = [
  // Clients
  { type: 'client', canonicalName: 'CNB', aliases: ['Conseil National des Barreaux'] },
  { type: 'client', canonicalName: 'Sesam-Vitale', aliases: ['SESAM-Vitale', 'Sesam Vitale'] },
  { type: 'client', canonicalName: 'IRA', aliases: ["Institut Regional d'Administration", 'IRAs'] },
  { type: 'client', canonicalName: 'DGAFP', aliases: ["Direction generale de l'administration"] },
  {
    type: 'client',
    canonicalName: 'Mauritius Government',
    aliases: ['Maurice', 'gouvernement mauricien'],
  },
  // Products
  { type: 'product', canonicalName: 'Twake Mail', aliases: ['Twake.Mail'] },
  { type: 'product', canonicalName: 'Twake Calendar', aliases: ['Twake.Calendar'] },
  { type: 'product', canonicalName: 'Twake Drive', aliases: ['Twake.Drive'] },
  { type: 'product', canonicalName: 'Twake Chat', aliases: ['Twake.Chat'] },
  { type: 'product', canonicalName: 'LinShare', aliases: ['LinShare Pro'] },
  { type: 'product', canonicalName: 'LinCloud', aliases: [] },
  { type: 'product', canonicalName: 'Apache James', aliases: ['James'] },
  { type: 'product', canonicalName: 'Office 365', aliases: ['Microsoft 365', 'O365'] },
  { type: 'product', canonicalName: 'Microsoft Exchange', aliases: ['Exchange'] },
  // Technologies
  { type: 'technology', canonicalName: 'JMAP', aliases: [] },
  { type: 'technology', canonicalName: 'IMAP', aliases: [] },
  { type: 'technology', canonicalName: 'CalDAV', aliases: [] },
  { type: 'technology', canonicalName: 'LDAP', aliases: ['Active Directory', 'AD'] },
  { type: 'technology', canonicalName: 'Kubernetes', aliases: ['K8s'] },
  { type: 'technology', canonicalName: 'PostgreSQL', aliases: ['Postgres'] },
  { type: 'technology', canonicalName: 'Matrix', aliases: ['Matrix protocol'] },
  { type: 'technology', canonicalName: 'SAML', aliases: [] },
  { type: 'technology', canonicalName: 'OIDC', aliases: ['OpenID Connect'] },
  { type: 'technology', canonicalName: 'LemonLDAP', aliases: ['LemonLDAP-NG'] },
  // Certifications
  { type: 'certification', canonicalName: 'SecNumCloud', aliases: [] },
  { type: 'certification', canonicalName: 'HDS', aliases: ['Hebergeur de Donnees de Sante'] },
  { type: 'certification', canonicalName: 'ISO27001', aliases: ['ISO 27001'] },
  // Regulations
  { type: 'regulation', canonicalName: 'GDPR', aliases: ['RGPD'] },
  { type: 'regulation', canonicalName: 'Cloud Act', aliases: ['CLOUD Act'] },
  // Partners
  {
    type: 'partner',
    canonicalName: 'DINUM',
    aliases: ['Direction interministerielle du numerique'],
  },
  { type: 'partner', canonicalName: 'OVH', aliases: ['OVHcloud'] },
  { type: 'partner', canonicalName: 'Cloud Temple', aliases: [] },
];

// ---- Initial validated tags ----
export const INITIAL_TAGS = [
  { slug: 'open-source', label: 'Open Source', category: 'concept' },
  { slug: 'sovereignty', label: 'Sovereignty', category: 'concept' },
  { slug: 'on-premise', label: 'On-Premise', category: 'deployment' },
  { slug: 'cloud-native', label: 'Cloud Native', category: 'deployment' },
  { slug: 'high-availability', label: 'High Availability', category: 'concept' },
  { slug: 'scalable', label: 'Scalable', category: 'concept' },
  { slug: 'interoperability', label: 'Interoperability', category: 'concept' },
  { slug: 'saas', label: 'SaaS', category: 'deployment' },
  { slug: 'self-hosted', label: 'Self-Hosted', category: 'deployment' },
  { slug: 'hybrid', label: 'Hybrid', category: 'deployment' },
  { slug: 'public-sector', label: 'Public Sector', category: 'industry' },
  { slug: 'health', label: 'Health', category: 'industry' },
  { slug: 'european-initiative', label: 'European Initiative', category: 'concept' },
];

// Must stay in sync with FRAGMENT_TYPES in packages/server/src/schema/fragment.ts
export const HARVESTER_TYPES = [
  'introduction', // general presentation, context
  'argument', // sales argument, benefit, key point
  'pricing', // pricing, rate card, economic model
  'clause', // contractual clause, condition, commitment
  'faq', // frequently asked question and answer
  'conclusion', // summary, call to action, next steps
  'bio', // person or team presentation
  'testimonial', // client testimonial, quote, feedback
  'methodology', // process, step, project phase
  'engagement', // commitment, SLA, guarantee
  'use-case', // use case, concrete example, scenario
  'other', // uncategorized content that fits no other type
];
