import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AdminMetadataTab } from '@/components/admin/metadata/admin-metadata-tab';

const ROLE_LEVEL: Record<string, number> = { reader: 0, contributor: 1, expert: 2, admin: 3 };
const hasRole = (role: string, min: string) => (ROLE_LEVEL[role] ?? 0) >= (ROLE_LEVEL[min] ?? 999);

export default function AdminPage() {
  const { user } = useAuth();
  if (!hasRole(user?.role ?? 'reader', 'admin')) return <Navigate to="/home" replace />;

  return (
    <div className="p-6">
      <h1 className="text-2xl font-medium mb-1">Admin</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Validate emergent metadata proposed by the LLM during ingestion
      </p>
      <Tabs defaultValue="metadata">
        <TabsList>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
          <TabsTrigger value="relations" disabled>
            Relations
          </TabsTrigger>
          <TabsTrigger value="supersedure" disabled>
            Supersedure
          </TabsTrigger>
          <TabsTrigger value="contradictions" disabled>
            Contradictions
          </TabsTrigger>
          <TabsTrigger value="users" disabled>
            Users
          </TabsTrigger>
          <TabsTrigger value="collections" disabled>
            Collections
          </TabsTrigger>
        </TabsList>
        <TabsContent value="metadata" className="mt-6">
          <AdminMetadataTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
