-- Étape 17 : numéro de ticket de transfert lisible et unique
-- (TRF-AAAA-NNNNNN), généré côté serveur à la création du transfert.
-- Migration strictement additive : aucune donnée existante n'est
-- modifiée ; les transferts antérieurs gardent ticket_no NULL et sont
-- présentés comme historiques sans ticket détaillé.
ALTER TABLE coupe_transfers ADD COLUMN ticket_no TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coupe_transfers_ticket_no
  ON coupe_transfers(ticket_no) WHERE ticket_no IS NOT NULL;
