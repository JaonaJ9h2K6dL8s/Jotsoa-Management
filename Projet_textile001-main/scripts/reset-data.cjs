// Suppression complète des données : utilisateurs, sessions, modules
// métier — la base SQLite est effacée puis recréée vide (migrations
// automatiques au prochain démarrage). Le premier administrateur se
// recrée ensuite avec `npm run create-admin`.
//
// Usage : npm run reset:data
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// Chemins possibles de la base (développement + application portable).
const candidates = [
  path.join(ROOT, 'data', 'jo-test-admin.db'), // base par défaut en dev
  path.join(ROOT, 'data', 'jo-management.db'), // base du serveur Next
  path.join(process.env.PORTABLE_EXECUTABLE_DIR ?? ROOT, 'data', 'jo-management.db'),
];

const suffixes = ['', '-wal', '-shm'];
let deleted = 0;

for (const file of candidates) {
  for (const suffix of suffixes) {
    const target = `${file}${suffix}`;
    if (fs.existsSync(target)) {
      try {
        fs.unlinkSync(target);
        process.stdout.write(`Supprimé : ${target}\n`);
        deleted += 1;
      } catch (error) {
        process.stderr.write(
          `Impossible de supprimer ${target} : ${error.message}\n` +
            'Fermez l\'application (serveur en cours) puis relancez.\n',
        );
        process.exit(1);
      }
    }
  }
}

if (deleted === 0) {
  process.stdout.write('Aucune base de données trouvée : rien à supprimer.\n');
} else {
  process.stdout.write(
    `\n${deleted} fichier(s) supprimé(s). Toutes les données et tous les\n` +
      'utilisateurs ont été effacés.\n' +
      'Au prochain démarrage, une base vide sera recréée automatiquement.\n' +
      'Créez ensuite le premier administrateur : npm run create-admin\n',
  );
}
