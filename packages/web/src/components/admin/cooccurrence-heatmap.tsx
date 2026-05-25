import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/api/client';

export function CooccurrenceHeatmap() {
  const [category, setCategory] = useState('');
  const [topN, setTopN] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['cooccurrence', category, topN],
    queryFn: async () => {
      const params = new URLSearchParams({ top_entities: String(topN) });
      if (category) params.set('category', category);
      return apiRequest<any>('GET', `/v1/admin/referential/cooccurrence?${params}`);
    },
  });

  if (isLoading) return <div className="text-muted-foreground text-sm">Calcul de la matrice...</div>;
  if (!data || !data.cells || data.cells.length === 0) {
    return <div className="text-muted-foreground text-sm">Pas de co-occurrence à afficher.</div>;
  }

  const { domains, entities, cells } = data;
  const cellMap = new Map<string, number>();
  for (const cell of cells) cellMap.set(`${cell.domain}::${cell.entity}`, cell.count);
  const maxCount = Math.max(...cells.map((c: any) => c.count), 1);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="px-3 py-1.5 border rounded-md text-sm bg-background">
          <option value="">Toutes catégories</option>
          <option value="client">Clients</option>
          <option value="product">Produits</option>
          <option value="technology">Technologies</option>
          <option value="partner">Partenaires</option>
        </select>
        <select value={topN} onChange={(e) => setTopN(parseInt(e.target.value, 10))} className="px-3 py-1.5 border rounded-md text-sm bg-background">
          <option value="10">Top 10 entités</option>
          <option value="20">Top 20 entités</option>
          <option value="30">Top 30 entités</option>
        </select>
      </div>

      <div className="overflow-auto border rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium sticky left-0 bg-muted/50 z-10 whitespace-nowrap">Domain \ Entity</th>
              {entities.map((e: any) => (
                <th key={e.id} className="px-2 py-2 text-left font-medium whitespace-nowrap" title={`${e.name} (${e.category})`}>
                  {e.name.length > 12 ? e.name.slice(0, 10) + '…' : e.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {domains.map((domain: string) => (
              <tr key={domain} className="border-t">
                <td className="px-3 py-2 font-medium sticky left-0 bg-background whitespace-nowrap">{domain}</td>
                {entities.map((e: any) => {
                  const count = cellMap.get(`${domain}::${e.name}`) ?? 0;
                  const intensity = count > 0 ? Math.max(0.1, count / maxCount) : 0;
                  return (
                    <td
                      key={e.id}
                      className="px-2 py-2 text-center"
                      style={{
                        backgroundColor: count > 0 ? `rgba(59,130,246,${intensity})` : 'transparent',
                        color: intensity > 0.6 ? 'white' : 'inherit',
                      }}
                    >
                      {count > 0 ? count : '·'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Fragments "approved" mentionnant à la fois le domain (lignes) et l'entité (colonnes). Plus la couleur est foncée, plus la co-occurrence est forte.
      </p>
    </div>
  );
}
