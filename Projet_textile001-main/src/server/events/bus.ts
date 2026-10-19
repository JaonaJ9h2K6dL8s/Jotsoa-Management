import { initDatabase } from '../db';
import type Database from 'better-sqlite3';

type DbWithChanges = Database.Database & { totalChanges(): number };

/**
 * Bus d'événements temps réel : détecte toute écriture dans la base
 * SQLite (peu importe la station qui l'a déclenchée) et notifie les
 * clients SSE connectés. La détection s'appuie sur le compteur interne
 * de better-sqlite3 (db.totalChanges), consulté à intervalle régulier :
 * coût négligeable même avec les postes de tous les départements.
 * L'état vit sur globalThis pour survivre au rechargement à chaud (dev).
 */

type Listener = () => void;

interface EventBus {
  listeners: Set<Listener>;
  timer: NodeJS.Timeout;
  lastChanges: number;
}

const globalRef = globalThis as typeof globalThis & {
  __joEventBus?: EventBus;
};

const POLL_INTERVAL_MS = 1000;

function checkChanges(bus: EventBus): void {
  let changes: number;
  try {
    changes = (initDatabase() as DbWithChanges).totalChanges();
  } catch {
    return;
  }
  if (changes !== bus.lastChanges) {
    bus.lastChanges = changes;
    for (const listener of bus.listeners) {
      try {
        listener();
      } catch {
        // Un client déconnecté ne doit pas bloquer les autres.
      }
    }
  }
}

function ensureBus(): EventBus {
  if (!globalRef.__joEventBus) {
    const bus: EventBus = {
      listeners: new Set(),
      timer: undefined as unknown as NodeJS.Timeout,
      lastChanges: 0,
    };
    try {
      bus.lastChanges = (initDatabase() as DbWithChanges).totalChanges();
    } catch {
      bus.lastChanges = 0;
    }
    bus.timer = setInterval(() => checkChanges(bus), POLL_INTERVAL_MS);
    // Le minuteur ne doit pas empêcher l'arrêt propre du processus.
    bus.timer.unref();
    globalRef.__joEventBus = bus;
  }
  return globalRef.__joEventBus;
}

export function subscribeToDbChanges(listener: Listener): () => void {
  const bus = ensureBus();
  bus.listeners.add(listener);
  return () => {
    bus.listeners.delete(listener);
  };
}
