import { AdminMetadataTab } from '@/components/admin/metadata/admin-metadata-tab';

export default function AdminMetadataPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Metadata</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Validate emergent metadata proposed by the LLM during ingestion
      </p>
      <AdminMetadataTab />
    </div>
  );
}
