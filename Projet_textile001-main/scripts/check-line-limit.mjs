#!/usr/bin/env node
/**
 * Contrôle de la limite de 400 lignes par fichier de code source.
 * Analyse src/, database/, scripts/ et les fichiers de configuration
 * racine. Exclut les dépendances et fichiers générés.
 * Sort avec le code 1 si au moins un fichier dépasse la limite.
 */

import fs from 'node:fs';
import path from 'node:path';

const LINE_LIMIT = 400;
const ROOT = process.cwd();

const SCAN_DIRS = ['src', 'database', 'scripts'];
const SCAN_FILES = [
  'next.config.ts',
  'postcss.config.mjs',
  'eslint.config.mjs',
];
const EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.sql',
]);
const EXCLUDED_FILES = new Set(['next-env.d.ts']);

function countLines(content) {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length;
}

function collectFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (
      EXTENSIONS.has(path.extname(entry.name)) &&
      !EXCLUDED_FILES.has(entry.name)
    ) {
      files.push(fullPath);
    }
  }
  return files;
}

function main() {
  const candidates = [];
  for (const dir of SCAN_DIRS) {
    const fullDir = path.join(ROOT, dir);
    if (fs.existsSync(fullDir)) {
      candidates.push(...collectFiles(fullDir));
    }
  }
  for (const file of SCAN_FILES) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      candidates.push(fullPath);
    }
  }

  const violations = [];
  for (const file of candidates) {
    const lines = countLines(fs.readFileSync(file, 'utf8'));
    if (lines > LINE_LIMIT) {
      violations.push({ file: path.relative(ROOT, file), lines });
    }
  }

  console.log(
    `Contrôle des ${LINE_LIMIT} lignes : ${candidates.length} fichier(s) analysé(s).`,
  );

  if (violations.length === 0) {
    console.log('Aucun fichier ne dépasse la limite.');
    return;
  }

  console.error('Fichiers dépassant la limite :');
  for (const violation of violations) {
    console.error(`  ${violation.file} — ${violation.lines} lignes`);
  }
  process.exitCode = 1;
}

main();
