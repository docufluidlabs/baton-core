/**
 * Preview App — uses MemoryRouter instead of BrowserRouter
 * so it works when opened as a local file:// HTML.
 */
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppLayout } from '../components/layout/AppLayout';
import DashboardPage from '../pages/DashboardPage';
import ConnectionsPage from '../pages/ConnectionsPage';
import WorkflowsPage from '../pages/WorkflowsPage';
import FlowBuilderPage from '../pages/FlowBuilderPage';
import SettingsPage from '../pages/SettingsPage';
import NotificationsPage from '../pages/NotificationsPage';
import ControlCenterPage from '../pages/ControlCenterPage';
import BulkUploadPage from '../pages/BulkUploadPage';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AuthProvider } from '../auth/AuthContext';

export default function PreviewApp() {
  return (
    <ErrorBoundary>
      <AuthProvider>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/flows" element={<FlowBuilderPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/control-center" element={<ControlCenterPage />} />
            <Route path="/bulk-upload" element={<BulkUploadPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
}
