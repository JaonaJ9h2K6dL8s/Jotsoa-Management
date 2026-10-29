-- Reconstruction du module Coupe (nouvelle interface, cahier des charges §7).
-- Ajuste les longueurs maximales des trois tables standard :
--   Table 1 : 1000 cm (inchangée), Table 2 : 900 cm, Table 3 : 800 cm.
-- Largeur 280 cm inchangée. Aucune donnée n'est supprimée : les
-- longueurs ne font qu'être élargies, les plans existants restent valides.
-- Les autres tables (ex. « Table HS » de test) ne sont pas touchées.

UPDATE coupe_tables SET longueur_max_cm = 900, updated_at = datetime('now')
WHERE nom = 'Table 2' AND longueur_max_cm <> 900;

UPDATE coupe_tables SET longueur_max_cm = 800, updated_at = datetime('now')
WHERE nom = 'Table 3' AND longueur_max_cm <> 800;
