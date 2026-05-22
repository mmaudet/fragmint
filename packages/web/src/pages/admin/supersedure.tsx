import { SupersedureTab } from '@/components/admin/supersedure/supersedure-tab';

export default function AdminSupersedurePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Remplacements</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Valider les propositions de remplacement détectées automatiquement à l&apos;ingestion
      </p>
      <SupersedureTab />
    </div>
  );
}
