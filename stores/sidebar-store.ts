import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SidebarState {
  isCollapsed: boolean;
}

interface SidebarActions {
  toggleCollapse: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

type SidebarStore = SidebarState & SidebarActions;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      isCollapsed: false,

      toggleCollapse: () => {
        set((state) => ({ isCollapsed: !state.isCollapsed }));
      },

      setCollapsed: (collapsed) => {
        set({ isCollapsed: collapsed });
      },
    }),
    {
      name: 'intuneget-sidebar-collapsed',
      partialize: (state) => ({ isCollapsed: state.isCollapsed }),
    }
  )
);
