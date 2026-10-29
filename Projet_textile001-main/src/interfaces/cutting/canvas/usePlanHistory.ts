'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Historique Annuler/Rétablir du plan de placement.
 * Les gestes en cours (`set` sans commit) remplacent l'état présent
 * sans créer d'entrée ; le commit (relâchement de souris, dépôt,
 * suppression) pousse l'état précédent dans le passé.
 */
export function usePlanHistory<T>(initial: T) {
  const [present, setPresent] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const [version, setVersion] = useState(0);

  const set = useCallback((next: T, commit: boolean) => {
    setPresent((current) => {
      if (commit) {
        past.current = [...past.current.slice(-49), current];
        future.current = [];
      }
      return next;
    });
    setVersion((value) => value + 1);
  }, []);

  /**
   * Commit d'un geste interactif : `baseline` est l'état DÉBUT du
   * geste (avant les modifications non validées), `final` l'état
   * retenu. Le présent est remplacé par `final` et `baseline` est
   * poussé dans le passé (Annuler restaure le début du geste).
   */
  const commit = useCallback((baseline: T, final: T) => {
    setPresent(() => {
      past.current = [...past.current.slice(-49), baseline];
      future.current = [];
      return final;
    });
    setVersion((value) => value + 1);
  }, []);

  const reset = useCallback((next: T) => {
    past.current = [];
    future.current = [];
    setPresent(next);
    setVersion((value) => value + 1);
  }, []);

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (previous === undefined) return;
    setPresent((current) => {
      future.current = [current, ...future.current.slice(0, 49)];
      return previous;
    });
    setVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (next === undefined) return;
    setPresent((current) => {
      past.current = [...past.current, current];
      return next;
    });
    setVersion((value) => value + 1);
  }, []);

  return {
    state: present,
    set,
    commit,
    reset,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
