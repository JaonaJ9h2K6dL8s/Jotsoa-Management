/**
 * Validations partagées (serveur d'abord, messages d'erreur en français).
 * Aucune dépendance : utilisable côté client comme côté serveur.
 */

const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,40}$/;

export interface FieldErrors {
  [field: string]: string;
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || username.trim().length === 0) {
    return "L'identifiant est requis.";
  }
  if (!USERNAME_PATTERN.test(username.trim())) {
    return "L'identifiant doit contenir entre 3 et 40 caractères (lettres, chiffres, . _ - uniquement).";
  }
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length === 0) {
    return 'Le mot de passe est requis.';
  }
  if (password.length < 8) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  }
  return null;
}

export function validateNom(nom: unknown): string | null {
  if (typeof nom !== 'string' || nom.trim().length < 2) {
    return 'Le nom est requis (2 caractères minimum).';
  }
  if (nom.trim().length > 80) {
    return 'Le nom ne doit pas dépasser 80 caractères.';
  }
  return null;
}

export function validatePrenom(prenom: unknown): string | null {
  if (prenom === undefined || prenom === null || prenom === '') {
    return null;
  }
  if (typeof prenom !== 'string' || prenom.trim().length > 80) {
    return 'Le prénom ne doit pas dépasser 80 caractères.';
  }
  return null;
}
