/**
 * Validations dédiées à la configuration générale (serveur d'abord).
 * Messages en français, réutilisables par les services et les formulaires.
 */

const CODE_PATTERN = /^[A-Za-z0-9_-]{2,20}$/;
const HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function validateLibelle(value: unknown, label = 'Le libellé'): string | null {
  if (typeof value !== 'string' || value.trim().length < 2) {
    return `${label} est requis (2 caractères minimum).`;
  }
  if (value.trim().length > 80) {
    return `${label} ne doit pas dépasser 80 caractères.`;
  }
  return null;
}

export function validateCode(value: unknown, label = 'Le code'): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return `${label} est requis.`;
  }
  if (!CODE_PATTERN.test(value.trim())) {
    return `${label} doit contenir entre 2 et 20 caractères (lettres, chiffres, - _).`;
  }
  return null;
}

export function validateDescription(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || value.trim().length > 500) {
    return 'La description ne doit pas dépasser 500 caractères.';
  }
  return null;
}

export function validateHexColor(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !HEX_PATTERN.test(value.trim())) {
    return 'Le code couleur doit être au format #RGB ou #RRGGBB.';
  }
  return null;
}

export function validateDisplayOrder(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const order = Number(value);
  if (!Number.isInteger(order) || order < 1 || order > 999) {
    return "L'ordre d'affichage doit être un entier entre 1 et 999.";
  }
  return null;
}

export function validatePositiveNumber(value: unknown, label: string): string | null {
  const number = Number(value);
  if (value === '' || value === undefined || value === null) {
    return `${label} est requise.`;
  }
  if (!Number.isFinite(number) || number <= 0) {
    return `${label} doit être un nombre strictement positif.`;
  }
  return null;
}

export function validatePeriod(value: unknown): string | null {
  if (value !== 'heure' && value !== 'jour') {
    return "La période de référence doit être « heure » ou « jour ».";
  }
  return null;
}

export function validateIsoDate(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return `${label} est requise (format AAAA-MM-JJ).`;
  }
  if (Number.isNaN(Date.parse(value))) {
    return `${label} est invalide.`;
  }
  return null;
}

export function validateOptionalIsoDate(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return validateIsoDate(value, label);
}

/** Normalisation pour la détection de doublons : minuscules, espaces réduits. */
export function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
