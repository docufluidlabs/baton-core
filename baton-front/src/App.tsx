import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Loader2 } from 'lucide-react';
import { AppLayout } from './components/layout/AppLayout';
import DashboardPage from './pages/DashboardPage';
import ConnectionsPage from './pages/ConnectionsPage';
import WorkflowsPage from './pages/WorkflowsPage';
import FlowBuilderPage from './pages/FlowBuilderPage';
import BulkUploadPage from './pages/BulkUploadPage';
import SettingsPage from './pages/SettingsPage';
import SalesforceSetupPage from './pages/SalesforceSetupPage';
import ConnectorSetupPage from './pages/ConnectorSetupPage';
import NotificationsPage from './pages/NotificationsPage';
import ControlCenterPage from './pages/ControlCenterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import SetupPage from './pages/auth/SetupPage';
import SignInPage from './pages/auth/SignInPage';
import InvitePage from './pages/auth/InvitePage';
import DocsApp from './docs/DocsApp';
import SubprocessorsPage from './pages/legal/SubprocessorsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useConnections } from './hooks/useApi';
import { useAuth } from './auth/AuthContext';

function RequiresDocuSign({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useConnections();
  if (isLoading) return null;
  const hasDocuSign = data?.connections?.some((c) => c.platform === 'docusign') ?? false;
  if (!hasDocuSign) return <Navigate to="/connections" replace />;
  return <>{children}</>;
}

// Redirect to an absolute URL outside the app. Used for /privacy and /terms,
// which now live on the FluidLabs marketing site rather than inside this SPA.
function ExternalRedirect({ to }: { to: string }) {
  useEffect(() => {
    window.location.replace(to);
  }, [to]);
  return null;
}

// Minimal splash while the AuthProvider probes /auth/status + /auth/me.
function AuthSplash() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <Loader2 className="w-6 h-6 text-gray-300 animate-spin" />
    </div>
  );
}

// Auth-gated portion of the app. Public routes (legal pages, docs, OAuth
// callback, /invite) are matched BEFORE this shell renders, so visitors can
// reach them without signing in.
function AuthenticatedApp() {
  const { loading, needsSetup, user } = useAuth();

  if (loading) return <AuthSplash />;

  // First run: no users exist yet — everything funnels into /setup.
  if (needsSetup) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Signed out: only the sign-in screen (invite links are public, above).
  if (!user) {
    return (
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  // Signed in: the full app. Auth screens bounce to /flows.
  return (
    <Routes>
      <Route path="/signin" element={<Navigate to="/flows" replace />} />
      <Route path="/setup" element={<Navigate to="/flows" replace />} />
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/flows" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/apps" element={<Navigate to="/connections" replace />} /> {/* legacy redirect */}
        <Route path="/platforms" element={<Navigate to="/connections" replace />} />
        <Route path="/workflows" element={<RequiresDocuSign><WorkflowsPage /></RequiresDocuSign>} />
        <Route path="/flows" element={<RequiresDocuSign><FlowBuilderPage /></RequiresDocuSign>} />
        <Route path="/bulk-upload" element={<RequiresDocuSign><BulkUploadPage /></RequiresDocuSign>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/control-center" element={<RequiresDocuSign><ControlCenterPage /></RequiresDocuSign>} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/salesforce-setup" element={<SalesforceSetupPage />} />
        <Route path="/setup/:slug" element={<ConnectorSetupPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Toaster position="top-right" richColors />

      <Routes>
        {/* Public, no-auth routes.
            Privacy / Terms / Contact live on fluidlabs.com — the canonical
            FluidLabs marketing site. The /subprocessors page is unique to
            the Baton platform and stays in this SPA. */}
        <Route path="/subprocessors" element={<SubprocessorsPage />} />

        {/* Public user documentation — its own full-screen reader, accessible
            signed-in or signed-out so it can be linked externally. The in-app
            sidebar has a "Docs" entry pointing here. */}
        <Route path="/docs/*" element={<DocsApp />} />

        {/* Invite acceptance — public by design: the recipient has no account
            yet. Reads ?token= and signs the new member straight in. */}
        <Route path="/invite" element={<InvitePage />} />

        {/* External redirects — privacy + terms moved to fluidlabs.com. */}
        <Route path="/privacy" element={<ExternalRedirect to="https://fluidlabs.com/privacy-policy" />} />
        <Route path="/terms" element={<ExternalRedirect to="https://fluidlabs.com/terms-of-use" />} />
        <Route path="/contact" element={<ExternalRedirect to="https://fluidlabs.com/contact" />} />

        {/* Legacy /salesforce/* paths — preserve backward compat for anything
            already shared (Salesforce package docs, bookmarks). */}
        <Route path="/salesforce/privacy" element={<ExternalRedirect to="https://fluidlabs.com/privacy-policy" />} />
        <Route path="/salesforce/terms" element={<ExternalRedirect to="https://fluidlabs.com/terms-of-use" />} />
        <Route path="/salesforce/subprocessors" element={<Navigate to="/subprocessors" replace />} />

        <Route path="/callback" element={<OAuthCallbackPage />} />

        {/* Everything else falls through to the session-gated app. */}
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
