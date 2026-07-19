import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react';
import { Toaster } from 'sonner';
import { AppLayout } from './components/layout/AppLayout';
import DashboardPage from './pages/DashboardPage';
import ConnectionsPage from './pages/ConnectionsPage';
import WorkflowsPage from './pages/WorkflowsPage';
import FlowBuilderPage from './pages/FlowBuilderPage';
// import EventsPage from './pages/EventsPage'; // Moved to sidebar in FlowBuilder
import SettingsPage from './pages/SettingsPage';
import SalesforceSetupPage from './pages/SalesforceSetupPage';
import ConnectorSetupPage from './pages/ConnectorSetupPage';
import NotificationsPage from './pages/NotificationsPage';
import ControlCenterPage from './pages/ControlCenterPage';
import OAuthCallbackPage from './pages/OAuthCallbackPage';
import CreateOrgPage from './pages/CreateOrgPage';
import DocsApp from './docs/DocsApp';
import SubprocessorsPage from './pages/legal/SubprocessorsPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useConnections } from './hooks/useApi';

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

// Auth-gated portion of the app. Public routes (legal pages, OAuth callback)
// are matched BEFORE this shell renders, so visitors can read Privacy / Terms /
// Subprocessors without signing in — required for the AppExchange submission
// and for inbound marketing links.
function AuthenticatedApp() {
  return (
    <>
      <SignedOut>
        <div className="flex items-center justify-center min-h-screen bg-gray-50">
          <SignIn routing="hash" afterSignInUrl="/flows" afterSignUpUrl="/flows" />
        </div>
      </SignedOut>

      <SignedIn>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/flows" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/connections" element={<ConnectionsPage />} />
            <Route path="/apps" element={<Navigate to="/connections" replace />} /> {/* legacy redirect */}
            <Route path="/platforms" element={<Navigate to="/connections" replace />} />
            <Route path="/workflows" element={<RequiresDocuSign><WorkflowsPage /></RequiresDocuSign>} />
            <Route path="/flows" element={<RequiresDocuSign><FlowBuilderPage /></RequiresDocuSign>} />
            {/* <Route path="/events" element={<EventsPage />} /> */}{/* Moved to sidebar in FlowBuilder */}
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/control-center" element={<RequiresDocuSign><ControlCenterPage /></RequiresDocuSign>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/salesforce-setup" element={<SalesforceSetupPage />} />
            <Route path="/setup/:slug" element={<ConnectorSetupPage />} />
            <Route path="/create-org" element={<CreateOrgPage />} />
          </Route>
        </Routes>
      </SignedIn>
    </>
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

        {/* Everything else falls through to the Clerk-gated app. */}
        <Route path="/*" element={<AuthenticatedApp />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
