import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  // LayoutDashboard, // uncomment with Dashboard nav item
  Plug,
  Workflow,
  GitBranch,
  Activity,
  Bell,
  Settings,
  ChevronLeft,
  Menu,
  X,
  ShieldAlert,
  Calculator,
  BookOpen,
  CircleHelp,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useAuth, UserButton } from '@clerk/clerk-react';
import clsx from 'clsx';
import { NotificationsPanel } from './NotificationsPanel';
import { OrgSwitcher } from './OrgSwitcher';
import { setAuthTokenGetter, markAuthReady, setApiErrorHandler } from '@/lib/api';
import { toast } from 'sonner';
import { useLayoutStore } from '@/stores/layoutStore';
import { useFlowStore } from '@/stores/flowStore';
import { ActivityLogSidebar } from '@/components/flows/ActivityLogSidebar';
import { clarityIdentify, claritySetPage } from '@/lib/clarity';
import { useInstances, useAutomations, useConnections } from '@/hooks/useApi';
import { useIsHidden } from '@/hooks/useIsHidden';

const NAV_ITEMS = [
  // { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/flows', label: 'Flow Builder', icon: GitBranch },
  { to: '/workflows', label: 'Workflow Checker', icon: Workflow },
  // { to: '/events', label: 'Events', icon: Activity }, // Moved to sidebar in FlowBuilder
];

const BOTTOM_NAV_ITEMS = [
  { to: '/connections', label: 'Connections', icon: Plug },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/docs', label: 'Docs', icon: BookOpen },
];

/**
 * Map the current app screen to its user-guide page, so the header Help button
 * is contextual — it opens the docs page for whatever you're looking at.
 */
function helpDocForPath(pathname: string): string {
  const base = '/docs';
  if (pathname.startsWith('/flows')) return `${base}/flow-builder`;
  if (pathname.startsWith('/control-center')) return `${base}/control-center`;
  if (pathname.startsWith('/workflows')) return `${base}/workflows`;
  if (pathname.startsWith('/connections')) return `${base}/connections`;
  if (pathname.startsWith('/notifications')) return `${base}/notifications`;
  if (pathname.startsWith('/settings')) return `${base}/settings`;
  if (pathname.startsWith('/salesforce-setup')) return `${base}/salesforce`;
  if (pathname.startsWith('/setup/')) {
    const slug = pathname.split('/')[2];
    return slug ? `${base}/setup/${slug}` : `${base}/setup`;
  }
  return base;
}

function useControlCenterBadge() {
  const { data: instancesData } = useInstances({ status: 'failed', limit: 100 });
  const { data: autoData } = useAutomations({ refreshInterval: 60_000 });
  const dismissedIds = useLayoutStore((s) => s.dismissedIds);

  const failedCount = instancesData?.instances?.filter(
    (i) => !dismissedIds.includes(`inst:${i.id}`),
  ).length ?? 0;

  const erroredCount = autoData?.automations?.filter(
    (a) => a.status === 'error' && !dismissedIds.includes(`auto:${a.id}`),
  ).length ?? 0;

  return failedCount + erroredCount;
}

export function AppLayout() {
  const {
    sidebarCollapsed: collapsed,
    toggleSidebar,
    mobileSidebarOpen,
    openMobileSidebar,
    closeMobileSidebar,
  } = useLayoutStore();
  const ccBadge = useControlCenterBadge();
  const { isHidden } = useIsHidden();
  const { data: connectionsData } = useConnections();
  const hasDocuSign = connectionsData?.connections?.some((c) => c.platform === 'docusign') ?? false;
  const { getToken, userId, orgId, isLoaded, isSignedIn } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const clarityIdentified = useRef(false);

  // Activity Log — global panel, opened from the bottom nav, rendered at the
  // AppLayout level so it works from any route (not just /flows).
  const activityLogOpen = useFlowStore((s) => s.activityLogOpen);
  const activityLogWorkflowId = useFlowStore((s) => s.activityLogWorkflowId);
  const activityLogWorkflowName = useFlowStore((s) => s.activityLogWorkflowName);
  const openActivityLog = useFlowStore((s) => s.openActivityLog);
  const closeActivityLog = useFlowStore((s) => s.closeActivityLog);
  const openLogs = useFlowStore((s) => s.openLogs);

  // Wire Clerk's getToken into the plain API client and unblock all pending
  // API requests — but only once Clerk has fully loaded AND the user is signed
  // in. Without the isLoaded+isSignedIn guard, markAuthReady() fires while
  // getToken() still returns null (Clerk initialising), which causes a wave of
  // 401s that results in partial/empty data and intermittent blank canvas.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    setAuthTokenGetter(() => getToken());
    markAuthReady();
    setApiErrorHandler((err) => {
      if (err.status === 401) {
        toast.error('Verification failed. Please sign in again.', { id: 'auth-error' });
      } else {
        toast.error(err.message);
      }
    });
  }, [isLoaded, isSignedIn, getToken]);

  // Identify user in Clarity once after auth loads.
  useEffect(() => {
    if (userId && !clarityIdentified.current) {
      clarityIdentified.current = true;
      clarityIdentify(userId, orgId ?? undefined);
    }
  }, [userId, orgId]);

  // Tag page views in Clarity on route changes.
  useEffect(() => {
    claritySetPage(location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile backdrop */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 md:hidden"
          onClick={closeMobileSidebar}
        />
      )}

      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col bg-white border-r border-gray-200 transition-all duration-200',
          // Desktop: static sidebar with collapse support
          'md:relative md:flex md:translate-x-0',
          collapsed ? 'md:w-16' : 'md:w-60',
          // Mobile: overlay drawer
          mobileSidebarOpen
            ? 'fixed inset-y-0 left-0 z-50 w-72 flex'
            : 'hidden',
        )}
      >
        {/* Mobile close button */}
        <button
          onClick={closeMobileSidebar}
          className="md:hidden absolute top-3 right-3 p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Logo */}
        <div className="flex items-center h-14 px-4 border-b border-gray-100">
          {collapsed ? (
            <svg viewBox="0 0 223.96 287.65" className="w-8 h-8" aria-label="Baton">
              <path d="M42.5,220.14L1.09,89.14c-3.89-12.35,2.95-25.55,15.33-29.46,7.71-2.44,15.77-.69,21.69,4.04v127.86c0,9.94,1.5,19.5,4.39,28.56Z" fill="#FCCD63"/>
              <path d="M148.76,50.43l-24.32,45.61c-14.29,1.57-27.68,6.27-39.4,13.29v-39.15l22.32-41.85c6.08-11.44,20.31-15.77,31.75-9.65,11.44,6.08,15.77,20.31,9.65,31.75Z" fill="#FF5252"/>
              <path d="M221.07,237.16c-17.05,31.16-49.9,50.5-85.67,50.5-29.56,0-56.11-13.07-73.94-33.76-6.46-7.43-11.79-15.83-15.67-24.95-.63-1.44-1.19-2.88-1.76-4.36-.03-.06-.03-.13-.06-.19-.53-1.41-1.03-2.85-1.47-4.26-2.88-9.06-4.39-18.62-4.39-28.56V23.48C38.11,10.5,48.61,0,61.55,0s23.48,10.5,23.48,23.48v85.85c11.72-7.02,25.11-11.72,39.4-13.29,3.6-.41,7.27-.63,10.97-.63,35.76,0,68.61,19.37,85.67,50.53,6.24,11.38,2.04,25.64-9.37,31.88-11.35,6.21-25.64,2.01-31.81-9.34-8.81-16.11-25.83-26.08-44.48-26.08-27.71,0-50.25,21.91-50.37,48.96v.28c.03,4.39.6,8.68,1.72,12.76.22.75.44,1.5.69,2.23.19.6.41,1.19.63,1.79.34.94.72,1.85,1.13,2.73,7.77,17.37,25.51,29.59,46.2,29.59,18.65,0,35.67-10,44.48-26.08,6.21-11.41,20.47-15.61,31.81-9.37,11.41,6.24,15.61,20.47,9.37,31.88Z" fill="#05162B"/>
            </svg>
          ) : (
            <svg viewBox="0 0 974.2 287.65" className="h-7" aria-label="Baton">
              <path d="M42.5,220.14L1.09,89.14c-3.89-12.35,2.95-25.55,15.33-29.46,7.71-2.44,15.77-.69,21.69,4.04v127.86c0,9.94,1.5,19.5,4.39,28.56Z" fill="#FCCD63"/>
              <path d="M148.76,50.43l-24.32,45.61c-14.29,1.57-27.68,6.27-39.4,13.29v-39.15l22.32-41.85c6.08-11.44,20.31-15.77,31.75-9.65,11.44,6.08,15.77,20.31,9.65,31.75Z" fill="#FF5252"/>
              <path d="M221.07,237.16c-17.05,31.16-49.9,50.5-85.67,50.5-29.56,0-56.11-13.07-73.94-33.76-6.46-7.43-11.79-15.83-15.67-24.95-.63-1.44-1.19-2.88-1.76-4.36-.03-.06-.03-.13-.06-.19-.53-1.41-1.03-2.85-1.47-4.26-2.88-9.06-4.39-18.62-4.39-28.56V23.48C38.11,10.5,48.61,0,61.55,0s23.48,10.5,23.48,23.48v85.85c11.72-7.02,25.11-11.72,39.4-13.29,3.6-.41,7.27-.63,10.97-.63,35.76,0,68.61,19.37,85.67,50.53,6.24,11.38,2.04,25.64-9.37,31.88-11.35,6.21-25.64,2.01-31.81-9.34-8.81-16.11-25.83-26.08-44.48-26.08-27.71,0-50.25,21.91-50.37,48.96v.28c.03,4.39.6,8.68,1.72,12.76.22.75.44,1.5.69,2.23.19.6.41,1.19.63,1.79.34.94.72,1.85,1.13,2.73,7.77,17.37,25.51,29.59,46.2,29.59,18.65,0,35.67-10,44.48-26.08,6.21-11.41,20.47-15.61,31.81-9.37,11.41,6.24,15.61,20.47,9.37,31.88Z" fill="#05162B"/>
              <path d="M799.2,198.01v60.56c0,12.97,10.52,23.49,23.49,23.49s23.49-10.52,23.49-23.49v-60.9l-46.99.34Z" fill="#05162B"/>
              <path d="M886.7,95.86c-48.32,0-87.5,39.18-87.5,87.5v1.67l46.99.34v-2.01c0-22.38,18.14-40.51,40.51-40.51s40.51,18.14,40.51,40.51v75.21c0,12.97,10.52,23.49,23.49,23.49h0c12.97,0,23.49-10.52,23.49-23.49v-75.21c0-48.33-39.18-87.5-87.5-87.5Z" fill="#05162B"/>
              <path d="M626.99,183.78c3.02-23.44,21.02-42.39,47.99-42.39s45.68,19.27,48.42,43.08l47.96.35c-3.03-51.19-41.89-88.97-96.38-88.97s-92.32,37.08-96,87.58l48.01.35Z" fill="#05162B"/>
              <path d="M723.26,198.55c-3.1,23.4-21.06,42.12-48.28,42.12s-44.52-18.4-47.95-41.43l-6.22.05-41.78.34c3.77,50.08,42.4,86.97,95.95,86.97s93.23-37.65,96.38-88.39l-48.1.35Z" fill="#05162B"/>
              <path d="M512.62,182.95v-37.79h26.03c6.18,0,11.78-2.51,15.84-6.57,4.06-4.06,6.57-9.66,6.57-15.84,0-12.36-10.04-22.36-22.41-22.36h-26.03v-15.26c0-6.47-2.61-12.36-6.86-16.61-4.25-4.25-10.14-6.91-16.66-6.91-12.94,0-23.47,10.53-23.47,23.52v97.48l46.99.34Z" fill="#05162B"/>
              <path d="M553.91,237.3h-11.16c-20.72,0-30.13-10.53-30.13-30.81v-6.41l-46.99.34v12.45c0,41.77,23.32,69.2,69.59,69.2h5.07c9.9,0,18.69-6.52,21.44-16.08l3.86-13.04c2.32-7.82-3.57-15.65-11.69-15.65Z" fill="#05162B"/>
              <path d="M298.32,181.4c3.05-23.41,21.49-40.01,45.82-40.01s42.09,14.38,45.87,40.67l47.47.34c-3.39-52.67-41.73-86.55-93-86.55s-90.62,34.32-94.11,85.2l47.95.35Z" fill="#05162B"/>
              <path d="M412.55,200.8l-22.58.18c-4.25,18.3-18.11,32.89-38.53,35.73-3.04.43-6.13.39-9.18,0-22.84-2.99-37.86-16.8-42.69-35.06l-48.58.34c4.78,36.27,28.93,64.61,64.32,75.38,9.42,2.9,19.65,4.49,30.57,4.68,4.4-.1,8.69-.43,12.85-1.01,12.8-1.74,24.48-5.75,34.72-11.69,1.06,2.17,2.51,4.15,4.2,5.79,4.25,4.3,10.14,6.91,16.66,6.91,12.94,0,23.52-10.53,23.52-23.52v-57.93l-25.28.18Z" fill="#05162B"/>
            </svg>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const disabled = !hasDocuSign;
            if (disabled) {
              return (
                <div
                  key={to}
                  title="Connect Docusign to enable"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed select-none"
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {(!collapsed || mobileSidebarOpen) && <span>{label}</span>}
                </div>
              );
            }
            return (
              <NavLink
                key={to}
                to={to}
                onClick={closeMobileSidebar}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                  )
                }
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {(!collapsed || mobileSidebarOpen) && <span>{label}</span>}
              </NavLink>
            );
          })}
          {/* Control Center — with failure badge */}
          {!hasDocuSign ? (
            <div
              title="Connect Docusign to enable"
              className="relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 cursor-not-allowed select-none"
            >
              <ShieldAlert className="w-5 h-5 flex-shrink-0" />
              {(!collapsed || mobileSidebarOpen) && <span>Resolution Center</span>}
            </div>
          ) : (
            <NavLink
              to="/control-center"
              onClick={closeMobileSidebar}
              className={({ isActive }) =>
                clsx(
                  'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )
              }
            >
              <span className="relative shrink-0">
                <ShieldAlert className="w-5 h-5" />
                {ccBadge > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-0.5 leading-none">
                    {ccBadge > 9 ? '9+' : ccBadge}
                  </span>
                )}
              </span>
              {(!collapsed || mobileSidebarOpen) && <span>Resolution Center</span>}
            </NavLink>
          )}
        </nav>

        {/* Bottom */}
        <div className="border-t border-gray-100 p-2 space-y-0.5">
          {/* Legacy extras */}
          {isHidden && (
            <NavLink
              to="/extras"
              onClick={closeMobileSidebar}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )
              }
            >
              <Calculator className="w-5 h-5 flex-shrink-0" />
              {(!collapsed || mobileSidebarOpen) && <span>Extras</span>}
            </NavLink>
          )}
          {BOTTOM_NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeMobileSidebar}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                )
              }
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {(!collapsed || mobileSidebarOpen) && <span>{label}</span>}
            </NavLink>
          ))}
          <button
            onClick={toggleSidebar}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-gray-600 w-full"
          >
            <ChevronLeft
              className={clsx('w-5 h-5 transition-transform', collapsed && 'rotate-180')}
            />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Activity Log — global push-style sidebar that resizes main, sits
          between the nav rail and main content as a flex sibling. */}
      <ActivityLogSidebar
        open={activityLogOpen}
        workflowId={activityLogWorkflowId}
        workflowName={activityLogWorkflowName}
        onClose={closeActivityLog}
        onActionClick={(ruleId, ruleName, actionNumber) => {
          if (location.pathname !== '/flows') navigate('/flows');
          openLogs(ruleId, ruleName, actionNumber);
        }}
      />

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between h-14 px-4 md:px-6 border-b border-gray-200 bg-white">
          <button
            onClick={openMobileSidebar}
            className="md:hidden p-2 -ml-1 rounded-lg hover:bg-gray-100"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5 text-gray-600" />
          </button>
          <div className="hidden md:block" />
          <div className="flex items-center gap-3">
            <OrgSwitcher />
            <div className="w-px h-6 bg-gray-200" />
            <a
              href={helpDocForPath(location.pathname)}
              target="_blank"
              rel="noreferrer"
              aria-label="Help & documentation for this page"
              title="Help & docs for this page"
              className="p-2 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              <CircleHelp className="w-5 h-5" />
            </a>
            <button
              onClick={() => openActivityLog()}
              aria-label="Activity Log"
              title="Activity Log"
              className={clsx(
                'p-2 rounded-lg transition-colors',
                activityLogOpen
                  ? 'bg-violet-50 text-violet-600'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
              )}
            >
              <Activity className="w-5 h-5" />
            </button>
            <NotificationsPanel />
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: { avatarBox: 'w-8 h-8' },
              }}
            />
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 overflow-auto" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <Outlet />
        </div>
      </main>

    </div>
  );
}
