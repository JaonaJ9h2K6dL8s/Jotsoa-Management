/**
 * Types partagés de la configuration générale (étape 3).
 * Aucun de ces types n'expose de donnée sensible.
 */

export interface ReferenceRow {
  id: number;
  nom: string;
  description?: string | null;
  hexCode?: string | null;
  displayOrder?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReworkZoneRow extends ReferenceRow {
  productTypeIds: number[];
}

export interface DefectRow {
  id: number;
  code: string;
  nom: string;
  description: string;
  category: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  productTypeIds: number[];
  zoneIds: number[];
}

export interface SewingRoomRow {
  id: number;
  code: string;
  nom: string;
  description: string;
  isActive: boolean;
  lineCount: number;
}

export interface SewingLineRow {
  id: number;
  code: string;
  nom: string;
  roomId: number;
  roomNom: string;
  isActive: boolean;
}

export interface CadenceRow {
  id: number;
  productTypeId: number | null;
  productTypeNom: string | null;
  roomId: number | null;
  roomNom: string | null;
  lineId: number | null;
  lineNom: string | null;
  value: number;
  unit: string;
  period: 'heure' | 'jour';
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

export interface SettingRow {
  key: string;
  value: string;
  updatedAt: string;
}

export interface DashboardCounters {
  usersActive: number;
  usersInactive: number;
  productTypes: number;
  products: number;
  colors: number;
  sizes: number;
  reworkZones: number;
  defects: number;
  sewingRooms: number;
  sewingLines: number;
  cadences: number;
}

export interface DashboardAlert {
  level: 'warning' | 'info';
  message: string;
}

export interface DashboardRecentOperation {
  id: number;
  action: string;
  actor: string | null;
  details: string;
  createdAt: string;
}

export interface DashboardData {
  counters: DashboardCounters;
  alerts: DashboardAlert[];
  recentOperations: DashboardRecentOperation[];
}
