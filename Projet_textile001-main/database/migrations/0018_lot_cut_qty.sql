-- Étape 18 : quantités réellement coupées par taille du lot.
-- Complète le workflow automatisé : les résultats réels saisis à la
-- fin de la coupe sont stockés par taille sur le lot (les composants
-- détaillés restent dans coupe_component_results, cf. migration 0015).
-- Migration additive : aucune donnée existante n'est modifiée.
ALTER TABLE coupe_lot_sizes ADD COLUMN cut_qty REAL NOT NULL DEFAULT 0;
