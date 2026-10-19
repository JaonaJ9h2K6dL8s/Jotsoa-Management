# Réseau local — déploiement multi-postes (RJ45)

L'application fonctionne entièrement en **réseau local, sans Internet**.
Un poste central héberge le serveur et la base SQLite ; les postes des
départements (coupe, couture, contrôle qualité, stock, magasinier,
sécurité) s'y connectent avec un simple navigateur via câble RJ45.

## 1. Poste serveur (administration)

Le poste admin fait tourner le serveur. Il doit avoir une **IP fixe**
pour que les autres postes le trouvent toujours :

1. Paramètres Windows → Réseau → Modifier les options d'adaptateur
2. Carte Ethernet → Propriétés → IPv4
3. Exemple : IP `192.168.1.10`, masque `255.255.255.0`, passerelle vide
   (pas besoin d'Internet).

Le serveur écoute sur toutes les interfaces (`-H 0.0.0.0`) et affiche
l'adresse réseau au démarrage :

```
npm run dev        # développement
npm run build && npm start   # usage quotidien (recommandé)
```

```
▲ Local:   http://localhost:3000
▲ Network: http://192.168.1.10:3000   ← adresse à donner aux départements
```

## 2. Pare-feu Windows (une seule fois, sur le poste serveur)

Exécuter dans une invite de commandes **en administrateur** :

```bat
netsh advfirewall firewall add rule name="JO Management 3000" dir=in action=allow protocol=TCP localport=3000
```

## 3. Postes départements

Aucune installation : ouvrir le navigateur (Chrome/Edge) sur
`http://192.168.1.10:3000`, chacun avec son compte métier. Astuce :
créer un raccourci sur le bureau vers cette adresse. Ne pas éteindre le
poste serveur pendant la production ; en cas de coupure réseau, le
badge « Hors ligne » s'affiche et la reprise est automatique.

## 4. Temps réel

Un canal d'événements (`/api/events`) diffuse chaque écriture en base :
toute saisie faite depuis un poste apparaît en moins d'une seconde sur
les autres postes (compteurs et listes rafraîchis automatiquement,
indicateur « Temps réel » vert dans la barre du haut).

## 5. Sauvegarde

La base est un fichier : copier régulièrement `data/` vers une clé USB
ou un second disque (ex. robocopy planifié quotidien).
