/**
 * Politiques média par salon.
 *
 * Discord ne permet PAS de distinguer un GIF d'une image par permissions :
 * un GIF est un fichier image, et AutoMod ne voit que le texte, jamais les
 * pièces jointes. Le filtrage passe donc par l'inspection des messages.
 *
 * On vérifie l'extension ET le type MIME : un `.png` renommé en `.gif`
 * serait sinon accepté à tort.
 */

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'heic', 'avif'];
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'flv', 'wmv', 'm4v'];
const GIF_EXT = ['gif', 'gifv'];

/** Hébergeurs de GIF : leurs liens comptent comme des GIF, pas comme des liens. */
const GIF_HOSTS = /(?:tenor\.com|giphy\.com|gfycat\.com|media\.discordapp\.net\/attachments\/\S+\.gif)/i;

/** Plateformes vidéo acceptées dans les salons de clips. */
const VIDEO_HOSTS = /(?:youtube\.com|youtu\.be|twitch\.tv|clips\.twitch\.tv|medal\.tv|streamable\.com|kick\.com|dailymotion\.com|vimeo\.com)/i;

/** Détecte une URL, quelle qu'elle soit. */
const ANY_URL = /https?:\/\/\S+/i;

/**
 * Politiques disponibles. Chaque salon référence une clé via `mediaPolicy`
 * dans le plan ; sans clé, aucune restriction n'est appliquée.
 *
 * `allow` liste les natures de contenu tolérées :
 *   'gif' | 'image' | 'video' | 'link' | 'videoLink'
 */
export const MEDIA_POLICIES = {
  // Discussion : on garde le salon lisible. GIF tolérés, mais ni images,
  // ni vidéos, ni liens externes.
  discussion: {
    allow: ['gif'],
    reason:
      'Dans ce salon, seuls les **GIF** sont autorisés.\n' +
      'Les images, vidéos et liens externes sont à poster dans ' +
      '**#🎬-clips-et-memes**, où tout est permis.',
  },

  // Aucune restriction, invitations Discord comprises.
  free: {
    allow: ['gif', 'image', 'video', 'link', 'videoLink'],
    reason: null,
  },

  // Vidéos et liens de plateformes vidéo, rien d'autre. Plus attribuée à
  // aucun salon du plan, mais restée disponible : /config peut l'appliquer
  // à un salon au cas par cas.
  clips: {
    allow: ['video', 'videoLink'],
    reason:
      'Dans ce salon, seuls les **clips vidéo** et les **liens de plateformes** ' +
      '(YouTube, Twitch, Medal, Streamable…) sont autorisés.\n' +
      'Les images et GIF sont à poster dans **#🎬-clips-et-memes**.',
  },
};

/** Extension d'un nom de fichier, en minuscules. */
function extensionOf(name = '') {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Classe une pièce jointe : 'gif' | 'image' | 'video' | 'other'.
 *
 * L'extension et le type MIME doivent concorder : un fichier annoncé
 * `.gif` mais servi en `image/png` est traité comme une image.
 */
export function classifyAttachment(attachment) {
  const ext = extensionOf(attachment.name ?? '');
  const mime = String(attachment.contentType ?? '').toLowerCase();

  const extIsGif = GIF_EXT.includes(ext);
  const mimeIsGif = mime.includes('gif');

  // GIF seulement si les deux indices concordent (ou si l'un manque).
  if (extIsGif && (mimeIsGif || !mime)) return 'gif';
  if (mimeIsGif && !ext) return 'gif';

  // Extension .gif mais MIME contredisant : c'est le déguisement classique.
  if (extIsGif && mime && !mimeIsGif) {
    return mime.startsWith('video/') ? 'video' : 'image';
  }

  if (IMAGE_EXT.includes(ext) || mime.startsWith('image/')) return 'image';
  if (VIDEO_EXT.includes(ext) || mime.startsWith('video/')) return 'video';

  return 'other';
}

/**
 * Analyse le texte d'un message et renvoie les natures de liens présentes.
 * Un lien Tenor/Giphy compte comme un GIF : sans cela, « GIF autorisé »
 * n'aurait aucun sens puisque la plupart des GIF sont collés en lien.
 */
export function classifyLinks(content = '') {
  const found = new Set();

  // On classe chaque URL entière, une par une. Retirer seulement le nom
  // d'hôte laisserait « https:// » et le chemin derrière, qui seraient
  // recomptés comme un lien générique — un lien Tenor serait alors bloqué
  // dans un salon où les GIF sont pourtant autorisés.
  const urls = content.match(/https?:\/\/\S+/gi) ?? [];

  for (const url of urls) {
    if (GIF_HOSTS.test(url)) found.add('gif');
    else if (VIDEO_HOSTS.test(url)) found.add('videoLink');
    else found.add('link');
  }

  return found;
}

/**
 * Évalue un message au regard d'une politique.
 * Renvoie { allowed: true } ou { allowed: false, reason, offending }.
 */
export function evaluateMessage({ policyKey, content = '', attachments = [] }) {
  const policy = MEDIA_POLICIES[policyKey];
  if (!policy) return { allowed: true };

  const allow = new Set(policy.allow);
  const offending = new Set();

  for (const attachment of attachments) {
    const kind = classifyAttachment(attachment);
    // 'other' (documents, archives…) suit le sort des images : un salon
    // restreint n'a pas vocation à recevoir des fichiers arbitraires.
    const effective = kind === 'other' ? 'image' : kind;
    if (!allow.has(effective)) offending.add(effective);
  }

  for (const kind of classifyLinks(content)) {
    if (!allow.has(kind)) offending.add(kind);
  }

  if (offending.size === 0) return { allowed: true };

  return {
    allowed: false,
    reason: policy.reason,
    offending: [...offending],
  };
}
