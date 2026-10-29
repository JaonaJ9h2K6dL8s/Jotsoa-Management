/**
 * Registre des mascottes : définitions pures partagées entre le
 * serveur (validation) et le navigateur (rendu et réglages).
 * Aucune dépendance framework ici — données et validation seulement.
 */

export const MASCOT_IDS = [
  'bobine',
  'ciseaux',
  'tshirt',
  'aiguille',
  'pelote',
  'colis',
  'ours',
] as const;

export type MascotId = (typeof MASCOT_IDS)[number];

export interface MascotDefinition {
  id: MascotId;
  label: string;
  /** Bulle de bienvenue personnalisée affichée au chargement. */
  welcome: string;
}

export const MASCOTS: Record<MascotId, MascotDefinition> = {
  bobine: {
    id: 'bobine',
    label: 'Bobine de fil',
    welcome: 'Bonjour ! Prêt à filer vers un bon travail ?',
  },
  ciseaux: {
    id: 'ciseaux',
    label: 'Ciseaux',
    welcome: 'Bonjour ! Une belle découpe aujourd\u2019hui ?',
  },
  tshirt: {
    id: 'tshirt',
    label: 'T-shirt',
    welcome: 'Bonjour ! Prêt à commencer ?',
  },
  aiguille: {
    id: 'aiguille',
    label: 'Aiguille et fil',
    welcome: 'Bonjour ! Point par point, tout ira bien.',
  },
  pelote: {
    id: 'pelote',
    label: 'Pelote de laine',
    welcome: 'Bonjour ! Enroulons la journée ensemble.',
  },
  colis: {
    id: 'colis',
    label: 'Colis textile',
    welcome: 'Bonjour ! Prêt à expédier du beau travail ?',
  },
  ours: {
    id: 'ours',
    label: 'Ours en tenue de travail',
    welcome: 'Bonjour ! Prêt à commencer ?',
  },
};

export const ANIMATION_STYLES = ['calme', 'amical', 'vif'] as const;
export type AnimationStyle = (typeof ANIMATION_STYLES)[number];

export const ANIMATION_STYLE_LABELS: Record<AnimationStyle, string> = {
  calme: 'Calme',
  amical: 'Amical',
  vif: 'Vif',
};

export const ANIMATION_FREQUENCIES = ['rare', 'normal', 'frequent'] as const;
export type AnimationFrequency = (typeof ANIMATION_FREQUENCIES)[number];

export const ANIMATION_FREQUENCY_LABELS: Record<AnimationFrequency, string> = {
  rare: 'Rare',
  normal: 'Normal',
  frequent: 'Fréquent',
};

/** Intervalle (en secondes) entre deux animations occasionnelles. */
export const FREQUENCY_SECONDS: Record<AnimationFrequency, [number, number]> = {
  rare: [30, 45],
  normal: [15, 25],
  frequent: [8, 15],
};

export const POSITIONS = [
  'bas-droite',
  'bas-gauche',
  'haut-droite',
  'haut-gauche',
] as const;
export type MascotPosition = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<MascotPosition, string> = {
  'bas-droite': 'Bas droite',
  'bas-gauche': 'Bas gauche',
  'haut-droite': 'Haut droite',
  'haut-gauche': 'Haut gauche',
};

/** Configuration complète des préférences de mascotte d'un utilisateur. */
export interface MascotConfig {
  mascotId: MascotId;
  animationEnabled: boolean;
  animationStyle: AnimationStyle;
  animationFrequency: AnimationFrequency;
  messagesEnabled: boolean;
  position: MascotPosition;
}

/** Suggestion par défaut selon le métier (modifiable librement ensuite). */
export const DEFAULT_MASCOT_BY_ROLE: Record<string, MascotId> = {
  admin: 'ours',
  chef_coupe: 'ciseaux',
  chef_couture: 'aiguille',
  controleur_qualite: 'tshirt',
  retoucheur: 'aiguille',
  chef_stock: 'colis',
  chef_magasinier: 'colis',
  chef_securite: 'ours',
};

export function defaultMascotConfig(roleCode: string): MascotConfig {
  return {
    mascotId: DEFAULT_MASCOT_BY_ROLE[roleCode] ?? 'ours',
    animationEnabled: true,
    animationStyle: 'amical',
    animationFrequency: 'normal',
    messagesEnabled: true,
    position: 'bas-droite',
  };
}

/**
 * Valide une entrée utilisateur partielle et renvoie la configuration
 * complète correspondante. Chaque champ inconnu ou invalide renvoie une
 * erreur explicite ; aucun silencieux n'est toléré.
 */
export function buildMascotConfig(
  input: Record<string, unknown>,
  roleCode: string,
): MascotConfig {
  const base = defaultMascotConfig(roleCode);
  const errors: string[] = [];

  const pickString = (key: string): string | null => {
    const value = input[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      errors.push(`${key} doit être une chaîne de caractères.`);
      return null;
    }
    return value;
  };

  const pickBool = (key: string): boolean | null => {
    const value = input[key];
    if (value === undefined || value === null) return null;
    if (typeof value !== 'boolean') {
      errors.push(`${key} doit être vrai ou faux.`);
      return null;
    }
    return value;
  };

  let mascotId = base.mascotId;
  const rawMascot = pickString('mascotId');
  if (rawMascot !== null) {
    if ((MASCOT_IDS as readonly string[]).includes(rawMascot)) {
      mascotId = rawMascot as MascotId;
    } else {
      errors.push(`Mascotte inconnue : ${rawMascot}.`);
    }
  }

  let animationStyle = base.animationStyle;
  const rawStyle = pickString('animationStyle');
  if (rawStyle !== null) {
    if ((ANIMATION_STYLES as readonly string[]).includes(rawStyle)) {
      animationStyle = rawStyle as AnimationStyle;
    } else {
      errors.push(`Style d'animation inconnu : ${rawStyle}.`);
    }
  }

  let animationFrequency = base.animationFrequency;
  const rawFrequency = pickString('animationFrequency');
  if (rawFrequency !== null) {
    if ((ANIMATION_FREQUENCIES as readonly string[]).includes(rawFrequency)) {
      animationFrequency = rawFrequency as AnimationFrequency;
    } else {
      errors.push(`Fréquence d'animation inconnue : ${rawFrequency}.`);
    }
  }

  let position = base.position;
  const rawPosition = pickString('position');
  if (rawPosition !== null) {
    if ((POSITIONS as readonly string[]).includes(rawPosition)) {
      position = rawPosition as MascotPosition;
    } else {
      errors.push(`Position inconnue : ${rawPosition}.`);
    }
  }

  let animationEnabled = base.animationEnabled;
  const rawEnabled = pickBool('animationEnabled');
  if (rawEnabled !== null) animationEnabled = rawEnabled;

  let messagesEnabled = base.messagesEnabled;
  const rawMessages = pickBool('messagesEnabled');
  if (rawMessages !== null) messagesEnabled = rawMessages;

  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }

  return {
    mascotId,
    animationEnabled,
    animationStyle,
    animationFrequency,
    messagesEnabled,
    position,
  };
}

/** Messages contextuels facultatifs, affichés occasionnellement. */
export const CONTEXTUAL_MESSAGES: Record<MascotId, string[]> = {
  bobine: [
    'Astuce : garde le fil tendu, le résultat sera net !',
    'Bien joué, continue comme ça !',
  ],
  ciseaux: [
    'Découpe nette, travail propre !',
    'Astuce : vérifie tes mesures avant de couper.',
  ],
  tshirt: ['Beau travail aujourd\u2019hui !', 'Un pas après l\u2019autre, ça avance !'],
  aiguille: ['Chaque point compte, bravo !', 'Bien joué, continue comme ça !'],
  pelote: ['Tout se tricote, point par point !', 'Bien joué, continue comme ça !'],
  colis: ['Prêt à partir vers la suite !', 'Bien joué, continue comme ça !'],
  ours: ['Bien joué, continue comme ça !', 'L\u2019équipe peut compter sur toi !'],
};
