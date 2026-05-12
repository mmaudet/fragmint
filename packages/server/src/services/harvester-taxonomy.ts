// Default seed taxonomy — merged with existing DB domains/types at harvest time.
// Admins can extend the taxonomy by adding fragments with custom domains/types via API.
export const HARVESTER_DOMAINS = [
  'lincloud', // Linagora products: LinCloud, Twake, LinShare
  'commercial', // sales arguments, value proposition, differentiation
  'pricing', // pricing, costs, budgets, quotes
  'legal', // SLA, GDPR, contracts, guarantees, compliance
  'technical', // architecture, deployment, integration, security
  'methodology', // project phases, processes, deliverables
  'other', // out-of-scope or unclassifiable content
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
  'témoignage', // client testimonial, quote, feedback
  'reference-technique', // technical reference, architecture, spec
  'methodology', // process, step, project phase
  'engagement', // commitment, SLA, guarantee
  'cas-usage', // use case, concrete example, scenario
];
