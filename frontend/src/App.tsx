import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { ImportPage } from '@/pages/ImportPage';
import { ClientsPage } from '@/pages/ClientsPage';
import { ClientDetailPage } from '@/pages/ClientDetailPage';
import { AuditPage } from '@/pages/AuditPage';
import { MarketDataPage } from '@/pages/MarketDataPage';
import { RiskDashboardPage } from '@/pages/RiskDashboardPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { EodSnapshotsPage } from '@/pages/EodSnapshotsPage';
import { UnsettledIssuesPage } from '@/pages/UnsettledIssuesPage';

function ProtectedRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppLayout>
      <Routes>
        <Route index element={<DashboardPage />} />
        <Route path="market" element={<MarketDataPage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:clientId" element={<ClientDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="risk" element={<RiskDashboardPage />} />
        <Route path="risk/snapshots" element={<EodSnapshotsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="unsettled-issues" element={<UnsettledIssuesPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Routes>
    </AppLayout>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthGate />} />
        <Route path="/*" element={<ProtectedRoutes />} />
      </Routes>
    </BrowserRouter>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <LoginPage />;
}
