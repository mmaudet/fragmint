#!/usr/bin/env tsx
/**
 * Seeds plan templates for demo/dev.
 * Usage: FRAGMINT_API_TOKEN=<token> tsx scripts/seed-plan-templates.ts
 *    or: tsx scripts/seed-plan-templates.ts --token <token>
 *        tsx scripts/seed-plan-templates.ts --base-url http://localhost:3333
 */

const args = process.argv.slice(2);
const flagIndex = args.indexOf('--token');
const token = flagIndex !== -1 ? args[flagIndex + 1] : process.env.FRAGMINT_API_TOKEN;
const baseUrlIndex = args.indexOf('--base-url');
const baseUrl = baseUrlIndex !== -1 ? args[baseUrlIndex + 1] : 'http://localhost:3210';

if (!token) {
  console.error('Missing API token. Set FRAGMINT_API_TOKEN or pass --token <token>');
  process.exit(1);
}

const TEMPLATES = [
  {
    name: 'Plan Offre Technique',
    version: '1.0.0',
    description: "Structure d'une offre commerciale et technique",
    status: 'active',
    tags: ['offre', 'technique', 'commercial'],
    sections: [
      {
        title: 'Résumé exécutif',
        description: "Présentation synthétique de l'offre et de la valeur ajoutée",
        inferred_type: 'introduction',
      },
      {
        title: 'Compréhension du besoin',
        description: 'Reformulation du contexte client et des enjeux identifiés',
        inferred_type: 'introduction',
      },
      {
        title: 'Notre approche',
        description: 'Méthodologie, démarche projet et livrables proposés',
        inferred_type: 'methodology',
      },
      {
        title: 'Architecture proposée',
        description: 'Description technique de la solution et des composants clés',
        inferred_type: 'methodology',
      },
      {
        title: 'Références et expérience',
        description: 'Retours sur des projets similaires réalisés par Linagora',
        inferred_type: 'reference',
      },
      {
        title: 'Conditions commerciales',
        description: 'Tarification, délais et conditions contractuelles',
        inferred_type: 'argument',
      },
    ],
  },
  {
    name: 'Note de positionnement produit',
    version: '1.0.0',
    description: 'Structure pour présenter un produit ou une feature',
    status: 'active',
    tags: ['produit', 'positioning'],
    sections: [
      {
        title: 'Le problème',
        description: 'Douleur client ou gap marché adressé',
        inferred_type: 'introduction',
      },
      {
        title: 'Notre solution',
        description: "Description du produit et de sa proposition de valeur",
        inferred_type: 'argument',
      },
      {
        title: 'Avantages différenciants',
        description: 'Pourquoi nous plutôt que les alternatives',
        inferred_type: 'argument',
      },
      {
        title: 'Cas d\'usage',
        description: 'Scénarios concrets d\'utilisation',
        inferred_type: 'methodology',
      },
      {
        title: 'Prochaines étapes',
        description: 'Appel à l\'action et roadmap',
        inferred_type: 'argument',
      },
    ],
  },
];

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Seeding plan templates at ${baseUrl}…\n`);
  for (const tpl of TEMPLATES) {
    try {
      const { data } = await post('/v1/plan-templates', tpl);
      console.log(`✓ ${data.name} (${data.id}) — ${data.sections.length} sections`);
    } catch (err) {
      console.error(`✗ ${tpl.name}: ${(err as Error).message}`);
    }
  }
  console.log('\nDone.');
}

main();
