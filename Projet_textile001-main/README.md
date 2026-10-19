# Projet_textile001

**JO Management — Gestion intégrée de l'entreprise textile**

Application web de gestion pour entreprise textile (coupe, couture, contrôle qualité, retouche, stock, magasinier, sécurité), développée avec :

- Next.js 15 (App Router) + React 19 + TypeScript
- Material UI v7 + Tailwind CSS 4
- SQLite (better-sqlite3), accessible uniquement côté serveur

## Installation

```bash
npm install
npm run build
npm start
```

Le serveur démarre sur le port 3000. Les migrations de base de données s'appliquent automatiquement au premier accès.

## Scripts utiles

| Commande | Description |
|---|---|
| `npm run dev` | Développement |
| `npm run build` | Build de production |
| `npm run typecheck` | Vérification TypeScript |
| `npm run lint` | ESLint |
| `node scripts/check-line-limit.mjs` | Audit limite 400 lignes/fichier |
| `npm run test:coupe` | Tests module coupe (idem : couture, cq, retouche, stock, magasinier, securite, admin, auth, config) |
| `npm run reset:data` | Efface toutes les données et tous les utilisateurs (base recréée vide au prochain démarrage) |

## Version desktop (.exe)

Le build produit un exécutable portable Windows dans le dossier `V1_textile/`.

**Méthode simple (Windows)** : double-cliquez sur `build-exe.cmd` à la racine
du projet — il installe les dépendances, compile et génère
`V1_textile/JO-Management-Portable.exe`.

**Méthode manuelle** :

```bash
npm install
npm run desktop:build
```

Lancez ensuite `V1_textile/JO-Management-Portable.exe`. Le dossier `data`
(avec la base SQLite) est créé à côté de l'exe au premier lancement.

> Note : après `npm run reset:data`, recréez le premier administrateur avec
> `npm run create-admin`.
