'use client';

import { useEffect } from 'react';
import { uiAllowedRotations } from './frame';

/**
 * Raccourcis clavier de l'atelier (sans remplacer les commandes
 * visibles) :
 * - Ctrl+Z / Ctrl+Y : annuler / rétablir ;
 * - Suppr : supprimer toutes les pièces sélectionnées ;
 * - Ctrl+D : dupliquer la pièce principale sélectionnée ;
 * - flèches : déplacer la sélection (0,5 cm ; Maj = 5 cm) ;
 * - R : rotation vers l'angle autorisé suivant (droit-fil respecté) ;
 * - Échap : vider la sélection.
 * Inactif pendant la saisie dans un champ de formulaire.
 */
export function useKeyboardShortcuts(input: {
  /** Angles autorisés (repère écran) pour la pièce visée par une clé. */
  allowedRotationsOf: (key: string) => number[];
  currentRotationOf: (key: string) => number | null;
  selectedKeys: string[];
  canEdit: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: (keys: string[]) => void;
  onDuplicate: (key: string) => void;
  onNudge: (keys: string[], deltaX: number, deltaY: number) => void;
  onRotate: (key: string, rotation: number) => void;
  onClearSelection: () => void;
}): void {
  const {
    allowedRotationsOf, currentRotationOf, selectedKeys, canEdit,
    onUndo, onRedo, onDelete, onDuplicate, onNudge, onRotate, onClearSelection,
  } = input;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey && key === 'z') { event.preventDefault(); onUndo(); return; }
      if (event.ctrlKey && key === 'y') { event.preventDefault(); onRedo(); return; }
      if (!canEdit) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selectedKeys.length > 0) {
          event.preventDefault();
          onDelete(selectedKeys);
        }
        return;
      }
      if (event.ctrlKey && key === 'd') {
        event.preventDefault();
        if (selectedKeys[0]) onDuplicate(selectedKeys[0]);
        return;
      }
      if (event.key === 'Escape') { onClearSelection(); return; }
      if (event.key.startsWith('Arrow') && selectedKeys.length > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 5 : 0.5;
        const deltas: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0], ArrowRight: [step, 0],
          ArrowUp: [0, -step], ArrowDown: [0, step],
        };
        const [deltaX, deltaY] = deltas[event.key] ?? [0, 0];
        if (deltaX !== 0 || deltaY !== 0) onNudge(selectedKeys, deltaX, deltaY);
        return;
      }
      if (key === 'r' && selectedKeys[0]) {
        const first = selectedKeys[0];
        const allowed = allowedRotationsOf(first);
        const current = currentRotationOf(first);
        if (allowed.length === 0 || current === null) return;
        const position = allowed.indexOf(current);
        onRotate(first, allowed[(position + 1) % allowed.length]);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [allowedRotationsOf, currentRotationOf, selectedKeys, canEdit, onUndo,
    onRedo, onDelete, onDuplicate, onNudge, onRotate, onClearSelection]);
}
