const UNITS = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

/**
 * Convertit une durée lisible en millisecondes.
 * Accepte les formes composées : "1d6h", "2h30m", "90m".
 * Renvoie `null` si la chaîne est invalide — l'appelant décide du message.
 *
 * La validation est stricte : la chaîne doit être entièrement composée de
 * paires nombre+unité. Sans cela, "demain 5h" serait accepté comme "5h",
 * et l'utilisateur croirait avoir programmé autre chose que ce qui est pris.
 */
export function parseDuration(input) {
  if (!input) return null;

  const normalized = String(input).toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhdw])+$/.test(normalized)) return null;

  let total = 0;
  for (const [, value, unit] of normalized.matchAll(/(\d+)([smhdw])/g)) {
    total += Number(value) * UNITS[unit];
  }

  return total > 0 ? total : null;
}

/** Formate une durée en millisecondes vers un texte court en français. */
export function formatDuration(ms) {
  if (ms <= 0) return 'terminé';

  const days = Math.floor(ms / UNITS.d);
  const hours = Math.floor((ms % UNITS.d) / UNITS.h);
  const minutes = Math.floor((ms % UNITS.h) / UNITS.m);
  const seconds = Math.floor((ms % UNITS.m) / UNITS.s);

  const parts = [];
  if (days) parts.push(`${days}j`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!days && !hours && seconds) parts.push(`${seconds}s`);

  return parts.join(' ') || 'moins d\'une minute';
}
