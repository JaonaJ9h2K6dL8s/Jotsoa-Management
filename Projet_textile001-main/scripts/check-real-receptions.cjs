const db = require('better-sqlite3')('data/jo-test-admin.db', { readonly: true });
const rows = db.prepare(`
  SELECT r.id, r.transfer_id, t.code AS transfer_code, t.ticket_no,
         l.code AS lot_code, r.status, r.notes, r.received_at,
         u.nom || ' ' || u.prenom AS received_by_name
  FROM couture_receptions r
  JOIN coupe_transfers t ON t.id = r.transfer_id
  JOIN coupe_lots l ON l.id = r.lot_id
  LEFT JOIN users u ON u.id = r.received_by
  ORDER BY r.id DESC
`).all();
console.log(JSON.stringify(rows, null, 1));
console.log('--- lignes de réception (par transfert) ---');
const lines = db.prepare(`
  SELECT reception_id, size_id, qty_sent, qty_received
  FROM couture_reception_lines ORDER BY reception_id, size_id
`).all();
console.log(JSON.stringify(lines, null, 1));
db.close();
