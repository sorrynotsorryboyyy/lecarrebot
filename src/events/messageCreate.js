import { Events, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { CATEGORIES } from '../lib/blueprint.js';
import { evaluateMessage } from '../lib/mediaPolicy.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { grantMessageXp } from '../handlers/xp.js';
import { log } from '../lib/logger.js';

export const name = Events.MessageCreate;

/**
 * Carte cléSalon → politique média, construite une fois au chargement.
 */
const POLICY_BY_KEY = new Map(
  CATEGORIES.flatMap((cat) => cat.channels)
    .filter((spec) => spec.mediaPolicy)
    .map((spec) => [spec.key, spec.mediaPolicy]),
);

export async function execute(message) {
  if (message.author.bot || !message.guild) return;

  try {
    const cfg = await getGuildConfig(message.guild.id);

    // La modération passe avant l'XP : inutile de récompenser un message
    // qui va être supprimé.
    const removed = await enforceMediaPolicy(message, cfg);
    if (removed) return;

    await grantMessageXp(message, cfg);
  } catch (err) {
    log.debug(`Traitement du message ${message.id} impossible : ${err.message}`);
  }
}

/**
 * Applique la politique média du salon.
 * Renvoie `true` si le message a été supprimé.
 */
async function enforceMediaPolicy(message, cfg) {
  // Le staff n'est pas filtré : il doit pouvoir illustrer une annonce ou
  // partager une capture sans se heurter aux règles des membres.
  if (message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  const channelIds = parseJsonColumn(cfg.channel_ids);

  // On retrouve la clé du salon par son identifiant mémorisé : un salon
  // renommé reste ainsi correctement filtré.
  const key = Object.keys(channelIds).find((k) => channelIds[k] === message.channel.id);
  const policyKey = key ? POLICY_BY_KEY.get(key) : null;
  if (!policyKey) return false;

  const verdict = evaluateMessage({
    policyKey,
    content: message.content ?? '',
    attachments: [...message.attachments.values()],
  });

  if (verdict.allowed) return false;

  try {
    await message.delete();
  } catch {
    // Message déjà supprimé, ou permissions insuffisantes.
    return false;
  }

  const notice =
    `🚫 Ton message dans **#${message.channel.name}** a été supprimé.\n\n${verdict.reason}`;

  const sent = await message.author.send(notice).catch(() => null);

  // MP fermés : on prévient dans le salon, avec un message court qui
  // s'efface — sinon le membre ne comprend pas la suppression.
  if (!sent) {
    const warning = await message.channel
      .send({ content: `${message.author} ${verdict.reason}` })
      .catch(() => null);

    if (warning) setTimeout(() => warning.delete().catch(() => {}), 10_000);
  }

  return true;
}
