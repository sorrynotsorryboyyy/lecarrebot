/**
 * Lecture tolérante d'une colonne JSONB.
 *
 * PostgreSQL renvoie normalement un objet, mais la valeur peut arriver
 * sous forme de chaîne selon la façon dont elle a été écrite. On accepte
 * les deux, et on ne laisse jamais remonter `null` : les appelants
 * itèrent systématiquement sur le résultat.
 */
export function parseJsonColumn(value) {
  if (!value) return {};

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  return typeof value === 'object' ? { ...value } : {};
}
