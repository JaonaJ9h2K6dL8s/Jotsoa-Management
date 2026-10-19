# Audit et réalisation du module Coupe

## Architecture observée

Application Next.js 15 / React 19 / MUI, routes App Router, services `src/server`, SQLite `better-sqlite3` avec WAL, migrations incrémentales transactionnelles. Les postes clients utilisent l’API centrale ; aucun accès SQLite côté navigateur. Les rôles métier restent ceux du projet : notamment `chef_coupe`, `chef_couture`, contrôle qualité, retouche, stock. L’administrateur n’obtient pas implicitement les droits métier.

Les interfaces historiques sont dans `src/features`, pas dans `interfaces`. Les nouvelles interfaces seront dans `src/interfaces/coupe` ; les points d’entrée Next restent dans `src/app`, avec les nouveaux gestionnaires HTTP dans `src/routes/coupe`. Aucun déplacement global des modules existants.

## Audit fonctionnel et risques

| Fonction | Situation actuelle | Recommandation | Risque à éviter |
|---|---|---|---|
| Catalogue | Catalogue entreprise plus large que les huit familles demandées | Périmètre Coupe configurable, réutilisant produits et tailles ; conserver le catalogue global | Supprimer des produits utilisés en stock |
| Fiches | Mesures, versions et PDF disponibles | Associer les révisions de patrons à une version de fiche approuvée | Confondre mesures finies et géométrie de coupe |
| Patrons | Migration 0012 insère des contours simplifiés avec `is_validated=1` ; 72 occurrences dans la base examinée | Exiger une révision traçable, une échelle vérifiée et une approbation ; conserver les anciennes lignes | Considérer une démonstration comme patron industriel |
| Sélection | Filtre produit/taille ; versions multiples mélangées | Sélection explicite modèle/tissu/révision ; aucune substitution silencieuse | Placer deux versions simultanément |
| Moteur | Placement par boîtes/étagères ; orientation 0° possible même interdite ; arrondi des quantités aux couches | Contours contrôlés, orientations strictes, quantités divisibles, collisions et défauts vérifiés | Surproduction non autorisée, droit-fil incorrect |
| Tables | Dimensions et couches maximales ; pas de réservation temporelle | Vérifier et réserver les créneaux au serveur | Deux opérations simultanées |
| Rouleaux | Poids et quantité disponibles ; estimation client depuis des valeurs par défaut | Enregistrer dimensions/tissu, utiliser la longueur réelle, vérifier disponibilité au serveur | Inventer une longueur exploitable |
| Validation | Changement de statut sans revalidation complète | Transaction, contrôle des données et référence du plan affiché | Valider le dernier plan d’un autre poste |
| PDF | Dernier plan du produit utilisé sans lien avec la fiche/version ; contours historiques dans JSON | Export du plan sélectionné et de ses fiches figées ; ne pas inventer d’association | Modifier une ancienne production à la réimpression |
| Résultats | Résultats par taille et consommation réelle existants | Liaison plan/tâche et détail par composant ; réutiliser les tâches et transferts | Doubler la production d’un ensemble |
| Transfert | Un transfert confirmé par lot ; réception couture séparée | Conserver ce contrat, enrichir la traçabilité et générer le ticket | Réception implicite ou transfert doublonné |
| Contrôle → retouche → carton → stock | Services existants avec références aux lots, tailles et transferts | Aucune réécriture ; tests de non-régression | Perte de compatibilité aval |
| QR/historique | Génération locale et réimpression tracée | Génération transactionnelle depuis les données validées | Ticket sans contenu fiable |

## Adaptations prévues

Migration additive 0015 : catalogue Coupe, révisions de patrons, métadonnées vérifiables, contraintes tissu/rouleau, snapshots des plans et liaison des résultats aux plans. Aucun effacement de données ni réécriture des migrations appliquées. Les lignes de démonstration resteront consultables historiquement mais ne seront pas sélectionnables pour une nouvelle production.

Automatisation sûre : références, calculs, sélection d’une révision unique compatible, documents depuis snapshots, QR et historique. Approbation humaine obligatoire : mesures, échelle, révision de patron, plan, résultats réels et remise physique. Les mesures officielles et les contours industriels ne sont pas fournis : aucune valeur industrielle ne sera inventée.

## Vérification initiale

Le contrôle TypeScript global échoue avant modification (diagnostic local `data/typecheck-before-coupe.txt`) : scripts historiques, conversions de routes et anciens composants. Ces erreurs ne constituent pas une validation réussie. Les nouveaux contrôles seront distingués de ce diagnostic initial.

## Résultats

À compléter après implémentation et tests. Aucun résultat de production réel n’est créé à titre de test.
