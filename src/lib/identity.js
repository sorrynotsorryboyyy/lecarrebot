import { normalizeRankName } from './ranks.js';

/**
 * Rôles d'identité auto-attribuables — âge, genre, style de jeu.
 *
 * Même forme que les séries de rangs (`src/lib/ranks.js`), pour que les
 * menus, la réconciliation et la lecture soient partagés. La différence
 * tient au drapeau `multi` : le style de jeu accepte plusieurs choix.
 */

export const AGE = [
  { key: 'age18', name: '🔞 +18', color: 0xc0392b, emoji: '🔞', aliases: ['+18', '18+', 'majeur'] },
  { key: 'age-18', name: '🌱 -18', color: 0x27ae60, emoji: '🌱', aliases: ['-18', 'mineur'] },
];

/**
 * Genre.
 *
 * Les symboles ♂️ ♀️ ⚧️ sont des caractères Unicode anciens suivis d'un
 * sélecteur de variante (U+FE0F). Discord les refuse dans les options de
 * menu (COMPONENT_INVALID_EMOJI) — le panneau entier échouait à cause du
 * seul ⚧️. On utilise des emoji pleinement supportés.
 */
export const GENDER = [
  { key: 'g_h', name: '👨 Homme', color: 0x3498db, emoji: '👨', aliases: ['homme', 'h', 'male', '♂️ Homme'] },
  { key: 'g_f', name: '👩 Femme', color: 0xe91e63, emoji: '👩', aliases: ['femme', 'f', 'female', '♀️ Femme'] },
  { key: 'g_a', name: '🧑 Autre', color: 0x9b59b6, emoji: '🧑', aliases: ['autre', 'other', '⚧️ Autre'] },
];

export const PLAYSTYLE = [
  { key: 'ps_chill', name: '😎 Chill', color: 0x1abc9c, emoji: '😎', aliases: ['chill', 'casual', 'detente'] },
  { key: 'ps_comp', name: '🔥 Compétitif', color: 0xe67e22, emoji: '🔥', aliases: ['competitif', 'comp', 'tryhard'] },
];

/**
 * Groupes proposés dans le panneau « À propos de toi ».
 * `multi: true` autorise plusieurs choix simultanés dans le groupe.
 */
export const IDENTITY_GROUPS = {
  age: {
    id: 'age',
    label: 'Tranche d\'âge',
    placeholder: 'Ton âge…',
    ranks: AGE,
  },
  gender: {
    id: 'gender',
    label: 'Genre',
    placeholder: 'Ton genre…',
    ranks: GENDER,
  },
  playstyle: {
    id: 'playstyle',
    label: 'Style de jeu',
    placeholder: 'Ton style de jeu…',
    ranks: PLAYSTYLE,
    // On peut être à la fois chill et compétitif selon le moment.
    multi: true,
  },
};

/** Tous les rôles d'identité, groupes confondus. */
export const ALL_IDENTITY = [...AGE, ...GENDER, ...PLAYSTYLE];

/** Retrouve une définition par sa clé. */
export function identityByKey(key) {
  return ALL_IDENTITY.find((r) => r.key === key) ?? null;
}

/**
 * Table normalisée → clé, pour adopter un rôle existant du serveur
 * plutôt que d'en créer un doublon.
 */
const LOOKUP = new Map();
for (const spec of ALL_IDENTITY) {
  LOOKUP.set(normalizeRankName(spec.name), spec.key);
  for (const alias of spec.aliases) LOOKUP.set(normalizeRankName(alias), spec.key);
}

/** Déduit la clé d'identité correspondant à un nom de rôle Discord. */
export function identityKeyForRoleName(name) {
  const normalized = normalizeRankName(name);
  if (!normalized) return null;
  return LOOKUP.get(normalized) ?? null;
}
