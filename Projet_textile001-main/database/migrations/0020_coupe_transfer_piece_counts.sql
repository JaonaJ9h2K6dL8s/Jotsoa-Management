CREATE TABLE IF NOT EXISTS coupe_transfer_piece_counts (
  transfer_id INTEGER NOT NULL REFERENCES coupe_transfers(id),
  piece_id INTEGER NOT NULL REFERENCES pattern_pieces(id),
  qty_per_layer INTEGER NOT NULL CHECK (qty_per_layer >= 0),
  layers INTEGER NOT NULL CHECK (layers > 0),
  PRIMARY KEY (transfer_id, piece_id)
);

CREATE INDEX IF NOT EXISTS idx_coupe_transfer_piece_counts_piece
  ON coupe_transfer_piece_counts(piece_id);

CREATE TRIGGER IF NOT EXISTS protect_coupe_transfer_piece_counts_update
BEFORE UPDATE ON coupe_transfer_piece_counts
BEGIN
  SELECT RAISE(ABORT, 'Relevé de coupe transféré immuable.');
END;

CREATE TRIGGER IF NOT EXISTS protect_coupe_transfer_piece_counts_delete
BEFORE DELETE ON coupe_transfer_piece_counts
BEGIN
  SELECT RAISE(ABORT, 'Relevé de coupe transféré immuable.');
END;
