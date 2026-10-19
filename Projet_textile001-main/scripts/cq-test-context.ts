/**
 * Contexte partagé des tests du module Contrôle qualité.
 */

import type Database from 'better-sqlite3';
import type { Actor } from '../src/server/users/users-service';

export interface CqTestContext {
  db: Database.Database;
  CQ: Actor;
  CQ2: Actor;
  COUTURE: Actor;
  STOCK: Actor;
  productId: number;
  colorId: number;
  sizeIds: number[];
  defectId: number;
  zoneId: number | null;
  lots: Record<
    'A' | 'B' | 'C' | 'D' | 'E' | 'F',
    { lotId: number; transferId: number }
  >;
}
