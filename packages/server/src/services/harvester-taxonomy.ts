// Default seed taxonomy — merged with existing DB domains/types at harvest time.
// Admins can extend the taxonomy by adding fragments with custom domains/types via API.
// Domain = the SUBJECT MATTER (product / thematic area).
// Content nature (technical, commercial, legal…) goes in tags, not domain.
export const HARVESTER_DOMAINS = [
  'twake',     // Twake Workplace: messaging, visio, drive, tasks
  'lincloud',  // LinCloud / LinShare suite
  'linshare',  // LinShare file sharing (standalone)
  'linagora',  // Linagora corporate: company, methodology, generic content
  'other',     // out-of-scope or cross-product content
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
  'technical-reference', // technical reference, architecture, spec
  'methodology',         // process, step, project phase
  'engagement',          // commitment, SLA, guarantee
  'use-case',            // use case, concrete example, scenario
  'technical',           // technical content: architecture, specs, configuration
  'other',               // uncategorized content that fits no other type
];
