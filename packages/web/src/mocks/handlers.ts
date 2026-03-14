import { http, HttpResponse } from 'msw';

const fixtures = {
  fragments: [
    {
      id: 'frag-001', type: 'introduction', domain: 'souveraineté', lang: 'fr',
      quality: 'approved' as const, author: 'mmaudet', title: 'Introduction souveraineté',
      body_excerpt: 'Dans un contexte où la dépendance...', body: '# Introduction\n\nTexte complet.',
      created_at: '2026-03-14', updated_at: '2026-03-14', uses: 5, file_path: 'fragments/test.md',
    },
    {
      id: 'frag-002', type: 'argument', domain: 'open-source', lang: 'fr',
      quality: 'reviewed' as const, author: 'mmaudet', title: 'Open RAG vs propriétaire',
      body_excerpt: 'Les solutions propriétaires...', body: '# Argument\n\nTexte argument.',
      created_at: '2026-03-14', updated_at: '2026-03-14', uses: 3, file_path: 'fragments/test2.md',
    },
    {
      id: 'frag-003', type: 'pricing', domain: 'twake', lang: 'fr',
      quality: 'draft' as const, author: 'mmaudet', title: 'Tarification Twake',
      body_excerpt: 'Twake Workplace est disponible...', body: '# Pricing\n\nTarifs.',
      created_at: '2026-03-14', updated_at: '2026-03-14', uses: 0, file_path: 'fragments/test3.md',
    },
  ],
  inventory: {
    total: 3, by_type: { introduction: 1, argument: 1, pricing: 1 },
    by_quality: { approved: 1, reviewed: 1, draft: 1 },
    by_lang: { fr: { approved: 1, reviewed: 1, draft: 1 }, en: {} },
    gaps: [{ type: 'argument', domain: 'open-source', lang: 'en', status: 'missing_translation' }],
  },
  templates: [
    { id: 'tpl-001', name: 'Proposition commerciale', description: 'Template test',
      output_format: 'docx', version: '1.0', author: 'mmaudet',
      created_at: '2026-03-14', updated_at: '2026-03-14' },
  ],
};

export const handlers = [
  http.post('/v1/auth/login', () => {
    return HttpResponse.json({
      data: { token: 'test-jwt-token', user: { login: 'mmaudet', role: 'admin', display_name: 'Michel-Marie' } },
      meta: null, error: null,
    });
  }),
  http.get('/v1/fragments', () => {
    return HttpResponse.json({ data: fixtures.fragments, meta: { count: 3 }, error: null });
  }),
  http.get('/v1/fragments/:id', ({ params }) => {
    const frag = fixtures.fragments.find(f => f.id === params.id);
    if (!frag) return HttpResponse.json({ data: null, meta: null, error: 'Not found' }, { status: 404 });
    return HttpResponse.json({ data: frag, meta: null, error: null });
  }),
  http.post('/v1/fragments/search', () => {
    return HttpResponse.json({ data: fixtures.fragments.slice(0, 1), meta: { count: 1 }, error: null });
  }),
  http.post('/v1/fragments/inventory', () => {
    return HttpResponse.json({ data: fixtures.inventory, meta: null, error: null });
  }),
  http.get('/v1/templates', () => {
    return HttpResponse.json({ data: fixtures.templates, meta: { count: 1 }, error: null });
  }),
];
