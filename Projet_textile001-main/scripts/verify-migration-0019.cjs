/* Vérification non destructive de la migration 0019 sur une copie de la base. */
const fs = require('fs');
fs.copyFileSync('data/jo-test-admin.db', 'data/_verify-migration-copy.db');
const Database = require('better-sqlite3');
const { runMigrations } = require('../src/server/db/migrate.ts');
const db = new Database('data/_verify-migration-copy.db');
const applied = runMigrations(db);
console.log('migrations appliquées :', JSON.stringify(applied));
console.log(JSON.stringify(db.prepare('SELECT nom, longueur_max_cm FROM coupe_tables ORDER BY nom').all()));
db.close();
fs.unlinkSync('data/_verify-migration-copy.db');
console.log('copie de vérification supprimée — base réelle intacte');
