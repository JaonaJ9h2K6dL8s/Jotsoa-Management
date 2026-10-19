'use client';

import { create } from 'zustand';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Pont temps réel côté client : une connexion SSE vers /api/events,
 * un rafraîchissement automatique des données serveur dès qu'une
 * autre station écrit en base, et un état de connexion partagé pour
 * l'indicateur affiché dans la barre supérieure.
 */

export type RealtimeStatus = 'connecte' | 'deconnecte';

interface RealtimeState {
  status: RealtimeStatus;
  lastEventAt: number | null;
  setStatus: (status: RealtimeStatus) => void;
  touch: () => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  status: 'deconnecte',
  lastEventAt: null,
  setStatus: (status) => set({ status }),
  touch: () => set({ lastEventAt: Date.now() }),
}));

const REFRESH_DELAY_MS = 400;

export function RealtimeBridge() {
  const router = useRouter();
  const setStatus = useRealtimeStore((state) => state.setStatus);
  const touch = useRealtimeStore((state) => state.touch);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const source = new EventSource('/api/events');

    source.addEventListener('open', () => setStatus('connecte'));
    source.addEventListener('hello', () => setStatus('connecte'));
    source.addEventListener('db', () => {
      touch();
      // Rafraîchissement regroupé : plusieurs écritures rapprochées
      // (saisie en série, imports) ne déclenchent qu'un seul re-rendu.
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        if (!document.hidden) router.refresh();
      }, REFRESH_DELAY_MS);
    });
    // En cas de coupure réseau (câble débranché, switch hors tension),
    // EventSource retente seul : on reflète juste l'état à l'écran.
    source.addEventListener('error', () => setStatus('deconnecte'));

    return () => {
      clearTimeout(refreshTimer.current);
      source.close();
      setStatus('deconnecte');
    };
  }, [router, setStatus, touch]);

  return null;
}
