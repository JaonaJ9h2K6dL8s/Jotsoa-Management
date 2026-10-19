/**
 * Test scratch : applique toutes les migrations sur une base neuve
 * et vérifie les patrons insérés par 0012. Aucune donnée réelle touchée.
 */
import Database from 'better-sqlite3';
import { runMigrations } from '../src/server/db/migrate';

const DB_PATH = './data/scratch-mig.db';
for (const suffix of ['', '-wal', '-shm']) {
  const p = DB_PATH + suffix;
  if (fsExists(p)) fsUnlink(p);
}
function fsExists(p: string): boolean {
  return require('node:fs').existsSync(p);
}
function fsUnlink(p: string): void {
  require('node:fs').unlinkSync(p);
}

const db = new Database(DB_PATH);
const applied = runMigrations(db);
console.log('APPLIQUEES:', applied.join(', ') || '(aucune)');
const n = (db.prepare('SELECT COUNT(*) c FROM pattern_pieces').get() as { c: number }).c;
console.log('PATRONS_INSERES:', n);
const ex = db
  .prepare(
    `SELECT pp.piece_label, pp.width_cm, pp.height_cm, pp.qty_multiplier,
            s.nom AS taille, p.nom AS produit
     FROM pattern_pieces pp
     JOIN sizes s ON s.id = pp.size_id
     JOIN products p ON p.id = pp.product_id
     ORDER BY p.nom, s.display_order, pp.piece_code LIMIT 6`,
  )
  .all();
console.log(JSON.stringify(ex, null, 1));
db.close();
