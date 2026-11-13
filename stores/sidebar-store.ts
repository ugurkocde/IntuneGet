import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isCollapsed: boolean;
  /** Small-screen drawer state. Never persisted: a reload starts closed. */
  isMobileOpen: boolean;
}

interface SidebarActions {
  toggleCollapse: () => void;
  setCollapsed: (collapsed: boolean) => void;
  setCollapsedFromServer: (collapsed: boolean) => void;
  openMobile: () => void;
  closeMobile: () => void;
}

type SidebarStore = SidebarState & SidebarActions;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isCollapsed: false,
      isMobileOpen: false,

      openMobile: () => {
        set({ isMobileOpen: true });
      },

      closeMobile: () => {
        set({ isMobileOpen: false });
      },

      toggleCollapse: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }));
      },

      setCollapsed: (collapsed) => {
        set({ isCollapsed: collapsed });
      },
      setCollapsedFromServer: (collapsed) => {
        set({ isCollapsed: collapsed });
      },
    }),
    {
      name: 'intuneget-sidebar-collapsed',
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    }
  )
);
