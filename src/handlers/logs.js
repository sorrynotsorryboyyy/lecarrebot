import { EmbedBuilder } from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { log } from '../lib/logger.js';

/**
 * Envoie un embed dans le salon de logs configuré.
 * Volontairement silencieux en cas d'échec : un salon de logs manquant ou
 * supprimé ne doit jamais faire échouer l'action de modération elle-même.
 */
export async function sendLog(guild, { color, title, description, fields = [], files = [] }) {
  try {
    const cfg = await getGuildConfig(guild.id);
    if (!cfg.logs_channel_id) return;

    const channel = await guild.channels.fetch(cfg.logs_channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    if (fields.length > 0) embed.addFields(fields);

    // `files` sert aux transcriptions de tickets : le contenu d'un salon
    // entier ne tiendrait pas dans un embed.
    await channel.send({ embeds: [embed], files });
  } catch (err) {
    log.debug('Écriture du log impossible', err.message);
  }
}
