import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Component, type ReactNode } from 'react';
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
import HarvestDebriefPage from '@/pages/harvest-debrief';
import PlanGenerationPage from '@/pages/plan-generation';
import HomePage from '@/pages/home';
import AdminFragmentsPage from '@/pages/admin/fragments';
import AdminMetadataPage from '@/pages/admin/metadata';
import AdminSupersedurePage from '@/pages/admin/supersedure';
import AdminCollectionsPage from '@/pages/admin/collections';
import AdminUsersPage from '@/pages/admin/users';
import { AdminPlaceholderPage } from '@/pages/admin/placeholder';
import { AdminHomePage } from '@/pages/admin/home';
import AdminRetrievalPage from '@/pages/admin/retrieval';
import { ReferentialItemDetailPage } from '@/pages/admin/referential-item-detail';
import { ActiveJobsProvider } from '@/contexts/active-jobs-context';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error;
      return (
        <div className="flex flex-col items-center justify-center h-screen p-8 text-center">
          <p className="text-destructive font-semibold text-lg mb-2">Something went wrong</p>
          <p className="text-sm text-muted-foreground mb-4 font-mono bg-muted p-2 rounded max-w-xl break-all">
            {err.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm underline text-primary"
          >
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
            <ActiveJobsProvider>
            <CollectionProvider>
              <BrowserRouter basename="/ui">
                <ErrorBoundary>
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
                    <Route path="/harvest/:jobId/debrief" element={<HarvestDebriefPage />} />
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
                    <Route index element={<AdminHomePage />} />
                    <Route path="fragments" element={<AdminFragmentsPage />} />
                    <Route path="metadata" element={<AdminMetadataPage />} />
                    <Route path="relations" element={<AdminPlaceholderPage title="Relations" description="Fragment relationship graph — coming soon" />} />
                    <Route path="supersedure" element={<AdminSupersedurePage />} />
                    <Route path="contradictions" element={<AdminPlaceholderPage title="Contradictions" description="Detected contradictions between fragments — coming soon" />} />
                    <Route path="users" element={<AdminUsersPage />} />
                    <Route path="collections" element={<AdminCollectionsPage />} />
                    <Route path="retrieval" element={<AdminRetrievalPage />} />
                    <Route path="referential/:type/:id" element={<ReferentialItemDetailPage />} />
                  </Route>
                </Routes>
              </ErrorBoundary>
              </BrowserRouter>
              <Toaster />
            </CollectionProvider>
            </ActiveJobsProvider>
          </TooltipProvider>
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
