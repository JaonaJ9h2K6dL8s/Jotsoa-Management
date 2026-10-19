const Database = require('better-sqlite3');
const db = new Database('data/scratch-nesting.db');
const p = db
  .prepare(
    `SELECT p.id FROM products p
     WHERE p.nom = 'T-shirt' AND p.is_active = 1
       AND EXISTS (SELECT 1 FROM pattern_pieces pp WHERE pp.product_id = p.id)
     LIMIT 1`,
  )
  .get();
const s = db
  .prepare("SELECT id FROM sizes WHERE nom IN ('M','L') ORDER BY display_order")
  .all();
console.log(JSON.stringify({ pid: p.id, sizes: s.map((x) => x.id) }));
