import { create } from 'zustand';

/**
 * État d'interface global (hors données métier).
 * Limité volontairement à la navigation mobile à ce stade.
 */
interface UiState {
  mobileNavOpen: boolean;
  toggleMobileNav: () => void;
  closeMobileNav: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  toggleMobileNav: () =>
    set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),
  closeMobileNav: () => set({ mobileNavOpen: false }),
}));
