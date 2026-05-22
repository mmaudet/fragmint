import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/lib/auth-context';
import { I18nProvider } from '@/lib/i18n';
import { CollectionProvider } from '@/lib/collection-context';
import { ProtectedRoute } from '@/components/protected-route';
import AppLayout from '@/layouts/app-layout';
import AdminLayout from '@/layouts/admin-layout';
import LoginPage from '@/pages/login';
import FragmentsPage from '@/pages/fragments';
import InventoryPage from '@/pages/inventory';
import ComposePage from '@/pages/compose';
import ValidationPage from '@/pages/validation';
import HarvestPage from '@/pages/harvest';
import PlanGenerationPage from '@/pages/plan-generation';
import HomePage from '@/pages/home';
import AdminMetadataPage from '@/pages/admin/metadata';
import { AdminPlaceholderPage } from '@/pages/admin/placeholder';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <TooltipProvider>
            <CollectionProvider>
              <BrowserRouter basename="/ui">
                <Routes>
                  <Route path="/login" element={<LoginPage />} />
                  <Route path="/" element={<Navigate to="/home" replace />} />
                  <Route
                    element={
                      <ProtectedRoute>
                        <AppLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route path="/home" element={<HomePage />} />
                    <Route path="/fragments" element={<FragmentsPage />} />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/compose" element={<ComposePage />} />
                    <Route path="/validation" element={<ValidationPage />} />
                    <Route path="/harvest" element={<HarvestPage />} />
                    <Route path="/plan-generation" element={<PlanGenerationPage />} />
                  </Route>
                  <Route
                    path="/admin"
                    element={
                      <ProtectedRoute>
                        <AdminLayout />
                      </ProtectedRoute>
                    }
                  >
                    <Route index element={<Navigate to="/admin/metadata" replace />} />
                    <Route path="metadata" element={<AdminMetadataPage />} />
                    <Route path="relations" element={<AdminPlaceholderPage title="Relations" description="Fragment relationship graph — coming soon" />} />
                    <Route path="supersedure" element={<AdminPlaceholderPage title="Supersedure" description="Manage fragment supersedure chains — coming soon" />} />
                    <Route path="contradictions" element={<AdminPlaceholderPage title="Contradictions" description="Detected contradictions between fragments — coming soon" />} />
                    <Route path="users" element={<AdminPlaceholderPage title="Users" description="User and token management — coming soon" />} />
                    <Route path="collections" element={<AdminPlaceholderPage title="Collections" description="Collection management — coming soon" />} />
                  </Route>
                </Routes>
              </BrowserRouter>
              <Toaster />
            </CollectionProvider>
          </TooltipProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
