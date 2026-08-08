/**
 * Rangs CS2 — source unique de vérité.
 *
 * Consommée par /setup (création et réconciliation des rôles), le menu de
 * sélection (handlers/ranks.js), /profil, /stats et /recherche. Toute évolution
 * des paliers se fait ici, et nulle part ailleurs.
 *
 * Deux séries indépendantes : un membre peut porter un rang Premier ET un
 * rang Faceit, mais un seul par série.
 */

/**
 * Premier CS2 — les couleurs reprennent la palette officielle Valve des
 * cotes (gris → bleu → violet → rose → rouge → or), pour un rendu
 * immédiatement familier aux joueurs.
 *
 * Note : les anciens rangs CSGO (Silver, Nova, Global Elite) n'existent
 * plus depuis le passage à CS2 en 2023 — ne pas les réintroduire.
 */
export const PREMIER = [
  { key: 'p1', name: '1k-3k',   color: 0xb0c3d9, emoji: '⬜', aliases: ['0-3k', '13k'] },
  { key: 'p2', name: '3k-6k',   color: 0x5e98d9, emoji: '🟦', aliases: [] },
  { key: 'p3', name: '6k-10k',  color: 0x4b69ff, emoji: '🔵', aliases: ['610k'] },
  { key: 'p4', name: '10k-13k', color: 0x8847ff, emoji: '🟣', aliases: [] },
  { key: 'p5', name: '13k-16k', color: 0xd32ce6, emoji: '🟪', aliases: [] },
  { key: 'p6', name: '16k-20k', color: 0xeb4b4b, emoji: '🟥', aliases: [] },
  { key: 'p7', name: '20k+',    color: 0xffd700, emoji: '🏆', aliases: ['20kplus', '20k', '20000plus'] },
];

/** Faceit — niveaux regroupés par paliers usuels. */
export const FACEIT = [
  { key: 'f1', name: 'Faceit 1-3',  color: 0x8d9297, emoji: '1️⃣', aliases: ['faceit13', 'fc13'] },
  { key: 'f2', name: 'Faceit 4-6',  color: 0xffc107, emoji: '4️⃣', aliases: ['faceit46', 'fc46'] },
  { key: 'f3', name: 'Faceit 7-8',  color: 0xff6b00, emoji: '7️⃣', aliases: ['faceit78', 'fc78'] },
  { key: 'f4', name: 'Faceit 9-10', color: 0xff1e1e, emoji: '🔟', aliases: ['faceit910', 'fc910'] },
];

/**
 * Séries exposées au menu de sélection.
 * `id` sert d'argument dans les customId (`ranks:set:<id>`) : il doit rester
 * court et sans deux-points, la convention de routage découpant sur ':'.
 */
export const RANK_SERIES = {
  premier: {
    id: 'premier',
    label: 'Rang Premier',
    placeholder: 'Choisis ta cote Premier…',
    ranks: PREMIER,
  },
  faceit: {
    id: 'faceit',
    label: 'Niveau Faceit',
    placeholder: 'Choisis ton niveau Faceit…',
    ranks: FACEIT,
  },
};

/** Tous les rangs, toutes séries confondues. */
export const ALL_RANKS = [...PREMIER, ...FACEIT];

/** Retrouve la définition d'un rang par sa clé. */
export function rankByKey(key) {
  return ALL_RANKS.find((r) => r.key === key) ?? null;
}

/** Retrouve la série à laquelle appartient une clé de rang. */
export function seriesOfKey(key) {
  return Object.values(RANK_SERIES).find((s) => s.ranks.some((r) => r.key === key)) ?? null;
}

/**
 * Normalise un nom de rôle en vue d'une comparaison tolérante.
 *
 * Retire les emoji et symboles, les accents, les espaces, les tirets et
 * les séparateurs de milliers, puis passe en minuscules :
 *
 *   '🔫 16K - 20k '  → '16k20k'
 *   '3K-6K'          → '3k6k'
 *   '20K +'          → '20k+'
 *
 * Sans cette normalisation, /setup ne reconnaîtrait aucun rôle existant
 * (la comparaison actuelle est stricte, emoji compris) et en créerait un
 * doublon à chaque exécution.
 */
export function normalizeRankName(name) {
  return String(name ?? '')
    // Décompose les accents puis retire les diacritiques.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Retire tout ce qui n'est ni lettre, ni chiffre, ni '+'.
    // Couvre d'un coup les emoji, espaces, tirets, points et underscores.
    .replace(/[^a-z0-9+]/g, '');
}

/**
 * Table de correspondance normalisée → clé de rang, construite une fois.
 * Contient le nom canonique et les alias de chaque rang.
 */
const LOOKUP = new Map();
for (const rank of ALL_RANKS) {
  LOOKUP.set(normalizeRankName(rank.name), rank.key);
  for (const alias of rank.aliases) {
    LOOKUP.set(normalizeRankName(alias), rank.key);
  }
}

/**
 * Déduit la clé de rang correspondant à un nom de rôle Discord.
 * Renvoie `null` si le rôle n'est pas un rang connu.
 *
 * Deux passes : correspondance exacte sur la forme normalisée, puis
 * repli sur les seuls chiffres, ce qui rattrape les préfixes libres
 * ('Premier 10k-13k', 'Rang 3k-6k') sans risque de collision — les
 * séquences de chiffres des sept paliers sont toutes distinctes.
 */
export function rankKeyForRoleName(name) {
  const normalized = normalizeRankName(name);
  if (!normalized) return null;

  const direct = LOOKUP.get(normalized);
  if (direct) return direct;

  const digits = normalized.replace(/[^0-9+]/g, '');
  if (!digits) return null;

  for (const [candidate, key] of LOOKUP) {
    if (candidate.replace(/[^0-9+]/g, '') === digits) return key;
  }
  return null;
}

/** Options de rang proposées par /recherche (limite Discord : 25 choix). */
export function lfgRankChoices() {
  return [
    ...ALL_RANKS.map((r) => ({ name: r.name, value: r.name })),
    { name: 'Peu importe', value: 'Peu importe' },
  ];
}
