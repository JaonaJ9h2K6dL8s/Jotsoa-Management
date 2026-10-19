const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database('data/jo-test-admin.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
console.log('TABLES:', tables.join(','));

let roles;
try {
  roles = db.prepare('SELECT * FROM roles').all();
} catch {
  roles = [];
}
console.log('ROLES:', JSON.stringify(roles));

const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
console.log('USER COLS:', cols.join(','));

function hashSync(pw) {
  return bcrypt.hashSync(pw, 10);
}

// Detect role id lookup
function roleIdOf(code) {
  if (!roles.length) return null;
  const r = roles.find((x) => x.code === code || x.role_code === code || x.name === code || x.label === code);
  return r ? (r.id ?? r.role_id) : null;
}

const adminRole = roleIdOf('admin') ?? (roles.length ? roles[0].id : null);
const chefRole = roleIdOf('chef_coupe');

console.log('adminRole=', adminRole, 'chefRole=', chefRole);

const insert = db.prepare(
  `INSERT INTO users (nom, prenom, username, password_hash, role_id, is_active, must_change_password, created_at, updated_at)
   VALUES (@nom, @prenom, @username, @password_hash, @role_id, 1, 0, datetime('now'), datetime('now'))`,
);

const existing = db.prepare('SELECT id, username FROM users').all();
console.log('EXISTING:', JSON.stringify(existing));

function upsert(nom, prenom, username, pw, roleId) {
  const found = existing.find((u) => u.username === username);
  if (found) {
    db.prepare('UPDATE users SET password_hash=?, role_id=?, is_active=1, must_change_password=0 WHERE id=?').run(
      hashSync(pw),
      roleId,
      found.id,
    );
    console.log('updated', username, 'id=', found.id);
    return found.id;
  }
  const res = insert.run({ nom, prenom, username, password_hash: hashSync(pw), role_id: roleId });
  console.log('created', username, 'id=', res.lastInsertRowid);
  return Number(res.lastInsertRowid);
}

upsert('Administrateur', 'JO', 'admin', 'Admin-2026!', adminRole);
upsert('Chef', 'Coupe', 'chef.coupe', 'Coupe-2026!', chefRole ?? adminRole);

console.log('DONE');
db.close();
