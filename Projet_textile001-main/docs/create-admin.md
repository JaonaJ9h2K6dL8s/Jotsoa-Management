# Création du premier administrateur — JO Management

## Principe

Aucun compte administrateur n'est créé automatiquement au démarrage et aucun
mot de passe par défaut n'existe dans le code source. Le premier administrateur
est créé avec la commande d'initialisation dédiée :

```cmd
npm run create-admin
```

Le script refuse de s'exécuter si un administrateur existe déjà (aucune
recréation accidentelle possible).

## Procédure

### Option A — saisie interactive

```cmd
npm run create-admin
```

Le script demande l'identifiant puis le mot de passe en **saisie masquée**
(le mot de passe ne s'affiche pas à l'écran et n'apparaît dans aucun fichier).

### Option B — variables d'environnement (déploiement automatisé)

```cmd
set ADMIN_INITIAL_USERNAME=admin.jo
set ADMIN_INITIAL_PASSWORD=MonMotDePasse1
npm run create-admin
```

Les variables ne sont lues qu'au moment de l'exécution : elles ne figurent
jamais dans le code source.

## Règles de validation

- Identifiant : 3 à 40 caractères, lettres/chiffres/`. _ -`.
- Mot de passe : 8 caractères minimum, avec au moins une lettre et un chiffre.
- Le mot de passe est haché avec bcryptjs (10 tours) : seul le hachage est
  enregistré en base.

## Changement de mot de passe forcé

Le compte est créé avec `must_change_password = 1`. À la première connexion,
l'utilisateur est redirigé vers `/change-password` et doit définir un nouveau
mot de passe avant d'accéder à son espace.

## Dépannage

- `Refusé : un administrateur existe déjà.` — utilisez la page
  **Administration → Utilisateurs** (réservée aux administrateurs) pour créer
  d'autres comptes ou réinitialiser un mot de passe oublié.
- Vérifier l'état de la base : `GET /api/health`.

## Base de données

Le chemin de la base est `./data/jo-test-admin.db` par défaut (voir
`src/server/db/connection.ts`), surchargeable par la variable
`DATABASE_PATH` (copier `.env.example`). Les migrations sont appliquées
automatiquement au premier accès (`database/migrations/*.sql`).
