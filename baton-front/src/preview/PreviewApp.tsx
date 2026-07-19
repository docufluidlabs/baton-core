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
import EventsPage from '../pages/EventsPage';
import SettingsPage from '../pages/SettingsPage';
import NotificationsPage from '../pages/NotificationsPage';
import ControlCenterPage from '../pages/ControlCenterPage';
import CreateOrgPage from '../pages/CreateOrgPage';
import { ErrorBoundary } from '../components/ErrorBoundary';

export default function PreviewApp() {
  return (
    <ErrorBoundary>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Toaster position="top-right" richColors />
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/workflows" element={<WorkflowsPage />} />
            <Route path="/flows" element={<FlowBuilderPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/control-center" element={<ControlCenterPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/create-org" element={<CreateOrgPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </ErrorBoundary>
  );
}
