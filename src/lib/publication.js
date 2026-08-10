import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SeparatorBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { COLORS } from './config.js';

/**
 * Moteur de rendu des publications (Components V2).
 *
 * Un embed classique ne sait pas afficher d'image AU-DESSUS du titre :
 * `setImage` la place en bas, `setThumbnail` en vignette. Les Components V2
 * lèvent cette limite — un conteneur peut ouvrir sur une galerie média, puis
 * enchaîner titre, texte et boutons, le tout ceinturé par une barre de
 * couleur comme un embed.
 *
 * Contraintes de la plateforme, toutes vérifiées ici :
 *   • un message V2 ne peut porter NI `content` NI `embeds` ;
 *   • 4000 caractères cumulés sur l'ensemble des blocs de texte ;
 *   • 40 composants au total dans le message ;
 *   • 10 rangées de composants par conteneur.
 */

/** Plafond de caractères d'un message V2, tous blocs de texte confondus. */
const MAX_TOTAL_CHARS = 4000;

/** Rangées d'action maximales dans un conteneur. */
const MAX_ROWS = 10;

/**
 * Une URL utilisable comme image ou comme lien de bouton.
 *
 * Discord rejette le message ENTIER si l'URL est malformée : mieux vaut
 * ignorer une image douteuse que perdre la publication. On exige http(s)
 * explicitement — `discord://` ou `javascript:` n'ont rien à faire ici.
 */
export function isValidUrl(value) {
  if (!value || typeof value !== 'string') return false;
  if (!/^https?:\/\/\S+$/i.test(value.trim())) return false;

  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Tronque proprement, en signalant la coupure. */
function truncate(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Compose le corps textuel : titre en gros, puis description.
 *
 * Le titre passe par un en-tête Markdown plutôt que par du gras : c'est ce
 * qui lui donne la taille d'un titre d'embed.
 */
function buildBody({ title, body }) {
  const lines = [];
  if (title) lines.push(`## ${truncate(title, 240)}`);
  if (body) lines.push(truncate(body, 3000));
  return lines.join('\n');
}

/**
 * Met en forme les champs libres.
 *
 * Un conteneur V2 n'a pas de notion de « field » : on rend chaque paire sur
 * sa propre ligne, ce qui reste lisible sans multiplier les blocs.
 */
function buildFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return null;

  return fields
    .filter((f) => f && f.name)
    .map((f) => `**${truncate(f.name, 100)}**\n${truncate(f.value ?? '—', 400)}`)
    .join('\n\n');
}

/**
 * Construit un message de publication prêt à envoyer.
 *
 * @param pub.title       Titre affiché en tête.
 * @param pub.body        Corps du message (Markdown accepté).
 * @param pub.imageUrl    Bannière affichée AU-DESSUS du titre.
 * @param pub.color       Couleur de la barre latérale.
 * @param pub.fields      [{ name, value }] — lignes complémentaires.
 * @param pub.linkUrl     Lien transformé en bouton.
 * @param pub.linkLabel   Libellé du bouton de lien.
 * @param pub.footer      Ligne discrète en bas du conteneur.
 * @param options.components  Rangées de boutons métier (inscription…).
 *
 * @returns { components, flags } — à passer tel quel à `channel.send`.
 */
export function buildPublication(pub = {}, { components = [] } = {}) {
  const container = new ContainerBuilder();

  const color = Number.isInteger(pub.color) ? pub.color : COLORS.primary;
  container.setAccentColor(color);

  // ─── La bannière, tout en haut ───────────────────────────────────
  // C'est la raison d'être du V2 ici. Une URL invalide est ignorée plutôt
  // que de faire échouer l'envoi complet.
  if (isValidUrl(pub.imageUrl)) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(pub.imageUrl.trim()),
      ),
    );
  }

  // ─── Titre et corps ──────────────────────────────────────────────
  const body = buildBody(pub);
  if (body) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }

  // ─── Champs libres ───────────────────────────────────────────────
  const fields = buildFields(pub.fields);
  if (fields) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(fields));
  }

  // ─── Pied de page ────────────────────────────────────────────────
  if (pub.footer) {
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`-# ${truncate(pub.footer, 200)}`),
    );
  }

  // ─── Bouton de lien ──────────────────────────────────────────────
  // Un bouton `Link` n'a pas de customId : il n'appelle pas le bot et ne
  // consomme donc aucun routage.
  const rows = [];
  if (isValidUrl(pub.linkUrl)) {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setURL(pub.linkUrl.trim())
        .setLabel(truncate(pub.linkLabel || 'Ouvrir le lien', 80)),
    ));
  }

  // ─── Boutons métier ──────────────────────────────────────────────
  for (const row of components) {
    if (rows.length >= MAX_ROWS) break;
    rows.push(row);
  }

  for (const row of rows) container.addActionRowComponents(row);

  return {
    components: [container],
    // Sans ce drapeau, l'API refuse le conteneur. Il interdit en retour
    // `content` et `embeds` sur le même message.
    flags: MessageFlags.IsComponentsV2,
  };
}

/**
 * Vérifie qu'une publication tient dans les limites de Discord.
 * Renvoie la liste des problèmes — vide si tout va bien.
 *
 * Appelé avant publication : un dépassement fait échouer l'envoi avec une
 * erreur d'API opaque, autant l'expliquer en français au rédacteur.
 */
export function validatePublication(pub = {}) {
  const problems = [];

  if (!pub.title || !String(pub.title).trim()) {
    problems.push('Le titre est obligatoire.');
  }

  // On mesure le texte BRUT, pas le rendu : `buildBody` tronque déjà chaque
  // bloc, donc valider sa sortie ne signalerait jamais de dépassement — et
  // le rédacteur verrait son texte amputé sans comprendre pourquoi.
  const total = [
    pub.title ?? '',
    pub.body ?? '',
    pub.footer ?? '',
    ...(Array.isArray(pub.fields)
      ? pub.fields.flatMap((f) => [f?.name ?? '', f?.value ?? ''])
      : []),
  ].join('').length;

  if (total > MAX_TOTAL_CHARS) {
    problems.push(
      `Le texte fait ${total} caractères, le maximum est ${MAX_TOTAL_CHARS}. ` +
      'Raccourcis la description ou retire des champs.',
    );
  }

  if (pub.imageUrl && !isValidUrl(pub.imageUrl)) {
    problems.push('Le lien de l\'image doit commencer par `http://` ou `https://`.');
  }

  if (pub.linkUrl && !isValidUrl(pub.linkUrl)) {
    problems.push('Le lien du bouton doit commencer par `http://` ou `https://`.');
  }

  if (Array.isArray(pub.fields) && pub.fields.length > 10) {
    problems.push('Pas plus de 10 champs personnalisés.');
  }

  return problems;
}

/**
 * Traduit une mention en contenu de message et en `allowedMentions`.
 *
 * Un message V2 ne peut pas porter de `content` : la mention part donc dans
 * un message distinct, juste avant la publication. C'est le seul moyen de
 * notifier tout en gardant la bannière en haut.
 *
 * `allowedMentions` est volontairement restrictif : on n'autorise QUE ce qui
 * a été demandé, jamais un `parse` complet qui laisserait passer une
 * mention glissée dans le texte.
 */
export function buildMention(mention) {
  if (!mention) return null;

  if (mention === 'everyone') {
    return { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  }

  if (mention === 'here') {
    return { content: '@here', allowedMentions: { parse: ['everyone'] } };
  }

  // Identifiant de rôle : on ne débloque QUE celui-ci.
  if (/^\d{17,20}$/.test(mention)) {
    return { content: `<@&${mention}>`, allowedMentions: { roles: [mention] } };
  }

  return null;
}

/**
 * Envoie une publication dans un salon, mention comprise.
 * Renvoie le message de la publication (pas celui de la mention).
 */
export async function sendPublication(channel, pub, { components = [] } = {}) {
  const mention = buildMention(pub.mention);

  if (mention) {
    await channel.send(mention).catch(() => {
      // Mention refusée (permission manquante) : la publication compte plus
      // que la notification, on continue.
    });
  }

  return channel.send(buildPublication(pub, { components }));
}
