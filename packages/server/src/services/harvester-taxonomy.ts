// Default seed taxonomy — merged with existing DB domains/types at harvest time.
// Admins can extend the taxonomy by adding fragments with custom domains/types via API.
// Domain = the SUBJECT MATTER (product / thematic area).
// Content nature (technical, commercial, legal…) goes in tags, not domain.
export interface DomainDef {
  slug: string;
  description: string;
}

export const HARVESTER_DOMAINS: DomainDef[] = [
  { slug: 'twake',    description: 'Twake Workplace — messaging, visio, collaborative drive, tasks. Use only when the text explicitly discusses Twake features or proposes Twake as a solution.' },
  { slug: 'lincloud', description: 'LinCloud / LinShare cloud suite. Use only when the text explicitly discusses LinCloud hosting or the LinShare suite.' },
  { slug: 'linshare', description: 'LinShare file sharing (standalone). Use only when the text is specifically about LinShare.' },
  { slug: 'linagora', description: 'Linagora company — ONLY for content explicitly about Linagora itself: company presentation, methodology, values, history. NOT for generic SLA, technical specs, or client requirements.' },
  { slug: 'other',    description: 'Generic or client-specific content: SLA definitions, procurement requirements, legal clauses, technical specs not tied to a specific product. When in doubt, use other.' },
];

// Must stay in sync with FRAGMENT_TYPES in packages/server/src/schema/fragment.ts
export const HARVESTER_TYPES = [
  'introduction',        // general presentation, context
  'argument',            // sales argument, benefit, key point
  'pricing',             // pricing, rate card, economic model
  'clause',              // contractual clause, condition, commitment
  'faq',                 // frequently asked question and answer
  'conclusion',          // summary, call to action, next steps
  'bio',                 // person or team presentation
  'testimonial',         // client testimonial, quote, feedback
  'methodology',         // process, step, project phase
  'engagement',          // commitment, SLA, guarantee
  'use-case',            // use case, concrete example, scenario
  'other',               // uncategorized content that fits no other type
];
