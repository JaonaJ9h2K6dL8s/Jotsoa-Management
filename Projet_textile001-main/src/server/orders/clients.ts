/**
 * Service clients (internes/externes).
 * Données minimales : nom, type, contact.
 */
import { ServiceError } from '@/server/api/service-error';
import { sessionsDb } from '@/server/auth/sessions';
import type { Actor } from '@/server/users/users-service';
import { requireId } from './common';

export interface ClientInput {
  nom: string;
  type?: 'interne' | 'externe';
  contact?: string;
  telephone?: string;
  email?: string;
  adresse?: string;
}

export interface ClientRow {
  id: number;
  nom: string;
  type: 'interne' | 'externe';
  contact: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  createdAt: string;
  updatedAt: string;
}

export function listClients(actor: Actor, search?: string): ClientRow[] {
  const db = sessionsDb();
  const base = `SELECT id, nom, type, contact, telephone, email, adresse,
    created_at createdAt, updated_at updatedAt FROM clients`;
  if (search && search.trim()) {
    const like = `%${search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    return db.prepare(`${base} WHERE nom LIKE ? ORDER BY nom`).all(like) as ClientRow[];
  }
  return db.prepare(`${base} ORDER BY nom`).all() as ClientRow[];
}

export function getClient(actor: Actor, id: number): ClientRow {
  const row = sessionsDb().prepare(`SELECT id, nom, type, contact, telephone, email, adresse,
    created_at createdAt, updated_at updatedAt FROM clients WHERE id=?`).get(requireId(id, 'Client')) as ClientRow | undefined;
  if (!row) throw new ServiceError('Client introuvable.', 404);
  return row;
}

export function createClient(actor: Actor, input: ClientInput): ClientRow {
  const db = sessionsDb();
  const nom = (input.nom || '').trim();
  if (!nom) throw new ServiceError('Le nom du client est obligatoire.', 400);
  const id = Number(
    db.prepare(`INSERT INTO clients (nom, type, contact, telephone, email, adresse)
                VALUES (?,?,?,?,?,?)`).run(
      nom,
      input.type === 'interne' ? 'interne' : 'externe',
      input.contact ?? null,
      input.telephone ?? null,
      input.email ?? null,
      input.adresse ?? null,
    ).lastInsertRowid,
  );
  return getClient(actor, id);
}

export function updateClient(actor: Actor, id: number, input: ClientInput): ClientRow {
  const db = sessionsDb();
  const current = getClient(actor, id);
  const nom = (input.nom ?? current.nom).trim();
  if (!nom) throw new ServiceError('Le nom du client est obligatoire.', 400);
  db.prepare(`UPDATE clients SET nom=?, type=?, contact=?, telephone=?, email=?, adresse=?
              WHERE id=?`).run(
    nom,
    input.type === 'interne' ? 'interne' : current.type,
    input.contact ?? current.contact,
    input.telephone ?? current.telephone,
    input.email ?? current.email,
    input.adresse ?? current.adresse,
    current.id,
  );
  return getClient(actor, current.id);
}

export function deleteClient(actor: Actor, id: number): void {
  const db = sessionsDb();
  const used = db.prepare('SELECT 1 FROM orders WHERE client_id=? LIMIT 1').get(id) as { '1': number } | undefined;
  if (used) throw new ServiceError('Ce client est lié à des commandes : suppression impossible.', 409);
  const res = db.prepare('DELETE FROM clients WHERE id=?').run(requireId(id, 'Client'));
  if (res.changes === 0) throw new ServiceError('Client introuvable.', 404);
}
