-- Migration 0023 : mascottes personnalisées par utilisateur.
-- Une seule configuration active par utilisateur (clé primaire user_id),
-- lue côté serveur à partir de l'utilisateur authentifié uniquement.
-- Table additive : aucune donnée existante n'est modifiée.

CREATE TABLE IF NOT EXISTS user_mascots (
  user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mascot_id          TEXT    NOT NULL CHECK (mascot_id IN (
                       'bobine', 'ciseaux', 'tshirt', 'aiguille',
                       'pelote', 'colis', 'ours')),
  animation_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (animation_enabled IN (0, 1)),
  animation_style    TEXT    NOT NULL DEFAULT 'amical' CHECK (animation_style IN ('calme', 'amical', 'vif')),
  animation_frequency TEXT   NOT NULL DEFAULT 'normal' CHECK (animation_frequency IN ('rare', 'normal', 'frequent')),
  messages_enabled   INTEGER NOT NULL DEFAULT 1 CHECK (messages_enabled IN (0, 1)),
  position           TEXT    NOT NULL DEFAULT 'bas-droite' CHECK (position IN ('bas-droite', 'bas-gauche', 'haut-droite', 'haut-gauche')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
