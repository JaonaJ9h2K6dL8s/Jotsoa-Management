-- Migration 0024 : suivi horaire du travail (début / fin / durée travaillée).
-- Couture : horodatage automatique des affectations (démarrage, pauses,
-- reprises, fin). Retouche : mêmes colonnes sur les affectations.
-- Les durées excluent les pauses : worked_seconds cumule les segments
-- « en_cours » (l'ancre de segment est updated_at, posée à chaque
-- transition). Données antérieures : colonnes NULL / 0, affichées « — ».
-- Tables additives : aucune donnée existante n'est modifiée.

ALTER TABLE couture_assignments ADD COLUMN started_at TEXT;
ALTER TABLE couture_assignments ADD COLUMN ended_at TEXT;
ALTER TABLE couture_assignments ADD COLUMN worked_seconds INTEGER NOT NULL DEFAULT 0;

ALTER TABLE rt_assignments ADD COLUMN started_at TEXT;
ALTER TABLE rt_assignments ADD COLUMN ended_at TEXT;
ALTER TABLE rt_assignments ADD COLUMN worked_seconds INTEGER NOT NULL DEFAULT 0;
