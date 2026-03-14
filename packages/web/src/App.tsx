import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth-context';
import { ProtectedRoute } from '@/components/protected-route';
import AppLayout from '@/layouts/app-layout';
import LoginPage from '@/pages/login';
import FragmentsPage from '@/pages/fragments';
import InventoryPage from '@/pages/inventory';
import ComposePage from '@/pages/compose';
import ValidationPage from '@/pages/validation';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter basename="/ui">
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<Navigate to="/fragments" replace />} />
            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/fragments" element={<FragmentsPage />} />
              <Route path="/inventory" element={<InventoryPage />} />
              <Route path="/compose" element={<ComposePage />} />
              <Route path="/validation" element={<ValidationPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}
