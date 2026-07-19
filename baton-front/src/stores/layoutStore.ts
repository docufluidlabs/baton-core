import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface LayoutStore {
  // Persisted
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  workflowViewMode: 'list' | 'grid';
  setWorkflowViewMode: (mode: 'list' | 'grid') => void;
  dismissedIds: string[];
  dismissItem: (id: string) => void;
  undismissItem: (id: string) => void;
  // Not persisted — resets on page load
  mobileSidebarOpen: boolean;
  openMobileSidebar: () => void;
  closeMobileSidebar: () => void;
}

export const useLayoutStore = create<LayoutStore>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      workflowViewMode: 'grid',
      setWorkflowViewMode: (mode) => set({ workflowViewMode: mode }),
      dismissedIds: [],
      dismissItem: (id) => set((s) => ({ dismissedIds: s.dismissedIds.includes(id) ? s.dismissedIds : [...s.dismissedIds, id] })),
      undismissItem: (id) => set((s) => ({ dismissedIds: s.dismissedIds.filter((d) => d !== id) })),
      mobileSidebarOpen: false,
      openMobileSidebar: () => set({ mobileSidebarOpen: true }),
      closeMobileSidebar: () => set({ mobileSidebarOpen: false }),
    }),
    {
      name: 'baton-layout',
      // Only persist desktop-relevant state
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed, workflowViewMode: s.workflowViewMode, dismissedIds: s.dismissedIds }),
    },
  ),
);
