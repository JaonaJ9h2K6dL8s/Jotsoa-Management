/**
 * Validations partagées du module Coupe (client + serveur).
 * Les mêmes règles sont appliquées côté serveur de manière
 * systématique — la validation du navigateur ne suffit jamais.
 */

export const ROLL_WEIGHT_MIN = 9;
export const ROLL_WEIGHT_MAX = 30;

/** Convertit une saisie numérique (virgule acceptée) en nombre. */
export function parseNumberInput(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim().replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Valide le poids initial d'un rouleau à la réception.
 * Retourne un message d'erreur en français, ou null si valide.
 * La règle 9–30 kg concerne uniquement le poids initial ;
 * le poids restant après consommation peut être inférieur à 9 kg.
 */
export function validateInitialWeight(raw: unknown): string | null {
  const value = parseNumberInput(raw);
  if (value === null) {
    return 'Le poids initial est requis et doit être numérique.';
  }
  if (value < 0) {
    return 'Le poids initial ne peut pas être négatif.';
  }
  if (value < ROLL_WEIGHT_MIN) {
    return `Le poids initial doit être au minimum de ${ROLL_WEIGHT_MIN} kg (reçu : ${value} kg).`;
  }
  if (value > ROLL_WEIGHT_MAX) {
    return `Le poids initial doit être au maximum de ${ROLL_WEIGHT_MAX} kg (reçu : ${value} kg).`;
  }
  return null;
}

/** Valide une quantité (entière ou décimale) strictement positive ou nulle. */
export function validateQty(
  raw: unknown,
  label: string,
  options: { positive?: boolean } = {},
): string | null {
  const value = parseNumberInput(raw);
  if (value === null) {
    return `${label} est requis(e) et doit être numérique.`;
  }
  if (value < 0) {
    return `${label} ne peut pas être négative.`;
  }
  if (options.positive && value === 0) {
    return `${label} doit être strictement positive.`;
  }
  return null;
}

/** Valide les quantités réelles d'un résultat de coupe. */
export function validateResultsRow(input: {
  cutQty: unknown;
  usableQty: unknown;
  anomalyQty: unknown;
  wasteQty: unknown;
}): string | null {
  const cut = parseNumberInput(input.cutQty);
  const usable = parseNumberInput(input.usableQty);
  const anomaly = parseNumberInput(input.anomalyQty);
  const waste = parseNumberInput(input.wasteQty);
  for (const [label, value] of [
    ['La quantité coupée', cut],
    ['La quantité utilisable', usable],
    ['La quantité en anomalie', anomaly],
    ['La quantité de déchets', waste],
  ] as const) {
    if (value === null) {
      return `${label} est requise et doit être numérique.`;
    }
    if (value < 0) {
      return `${label} ne peut pas être négative.`;
    }
  }
  if ((usable ?? 0) + (anomaly ?? 0) > (cut ?? 0)) {
    return "La somme des quantités utilisables et en anomalie ne peut pas dépasser la quantité coupée.";
  }
  return null;
}

/** Normalise un code manuel : majuscules, espaces réduits. */
export function normalizeCode(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
}

export function validateCode(raw: unknown, label: string): string | null {
  const code = normalizeCode(raw);
  if (!code) {
    return `${label} est requis.`;
  }
  if (code.length > 40) {
    return `${label} ne doit pas dépasser 40 caractères.`;
  }
  if (!/^[A-Z0-9._-]+$/.test(code)) {
    return `${label} ne doit contenir que des lettres, chiffres, tirets, points ou underscores.`;
  }
  return null;
}
