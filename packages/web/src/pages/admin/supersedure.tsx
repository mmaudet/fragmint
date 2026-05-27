import { SupersedureTab } from '@/components/admin/supersedure/supersedure-tab';

export default function AdminSupersedurePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Remplacements</h1>
      <p className="text-sm text-muted-foreground mb-2">
        Quand l&apos;ingestion détecte qu&apos;un fragment B semble remplacer un fragment A, une
        proposition est créée.
      </p>
      <ul className="text-sm text-muted-foreground mb-6 space-y-0.5 list-none">
        <li>
          <span className="font-medium text-foreground">Confirmer</span> — B remplace A&nbsp;: A est
          archivé, B devient la version de référence.
        </li>
        <li>
          <span className="font-medium text-foreground">Coexister</span> — les deux fragments sont
          intentionnellement maintenus&nbsp;: aucun n&apos;est archivé.
        </li>
        <li>
          <span className="font-medium text-foreground">Rejeter</span> — la proposition est
          incorrecte&nbsp;: les deux fragments n&apos;ont pas de lien de remplacement.
        </li>
      </ul>
      <SupersedureTab />
    </div>
  );
}
