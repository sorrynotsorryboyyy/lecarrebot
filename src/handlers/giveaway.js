import { EmbedBuilder, MessageFlags } from 'discord.js';
import { query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { buildGiveawayMessage } from '../lib/embeds.js';
import { isVip } from '../commands/admin/vip.js';

/** Participation au tirage. */
export async function enterGiveaway(interaction, giveawayId) {
  const { rows } = await query('SELECT * FROM giveaways WHERE id = $1', [giveawayId]);
  const g = rows[0];

  if (!g || g.ended) {
    return interaction.reply({
      content: '🔒 Ce giveaway est terminé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Giveaway réservé : le bouton reste visible pour tous, mais l'accès est
  // refusé avec une explication — masquer le bouton laisserait croire à un
  // bug plutôt qu'à une réservation.
  if (g.vip_only && !(await isVip(interaction.guild.id, interaction.user.id))) {
    return interaction.reply({
      content:
        '💎 Ce giveaway est réservé aux membres **Elite (VIP)**.\n\n' +
        'Contacte le staff pour savoir comment le devenir.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const inserted = await query(
    `INSERT INTO giveaway_entries (giveaway_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING user_id`,
    [giveawayId, interaction.user.id],
  );

  if (inserted.rowCount === 0) {
    return interaction.reply({
      content: 'ℹ️ Tu participes déjà à ce giveaway. Bonne chance !',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '🎉 Ta participation est enregistrée. Bonne chance !',
    flags: MessageFlags.Ephemeral,
  });

  await refreshGiveaway(interaction.client, giveawayId);
}

/** Met à jour le compteur de participants sur le message d'origine. */
async function refreshGiveaway(client, giveawayId) {
  const { rows } = await query('SELECT * FROM giveaways WHERE id = $1', [giveawayId]);
  const g = rows[0];
  if (!g?.message_id) return;

  const { rows: count } = await query(
    'SELECT COUNT(*)::int AS n FROM giveaway_entries WHERE giveaway_id = $1',
    [giveawayId],
  );

  try {
    const channel = await client.channels.fetch(g.channel_id);
    const message = await channel.messages.fetch(g.message_id);
    await message.edit(
      buildGiveawayMessage({
        id: g.id,
        prize: g.prize,
        winners: g.winners,
        endsAt: g.ends_at,
        entries: count[0].n,
        ended: g.ended,
        vipOnly: g.vip_only,
        conditions: g.conditions,
      }),
    );
  } catch (err) {
    log.debug(`Mise à jour du giveaway #${giveawayId} impossible : ${err.message}`);
  }
}

/** Tire au sort `n` gagnants distincts parmi les participants. */
function drawWinners(userIds, n) {
  const pool = [...userIds];
  const winners = [];

  while (winners.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }

  return winners;
}

/** Clôt un giveaway, tire les gagnants et les annonce. */
export async function endGiveaway(client, giveaway, { reroll = false } = {}) {
  const { rows: entries } = await query(
    'SELECT user_id FROM giveaway_entries WHERE giveaway_id = $1',
    [giveaway.id],
  );

  if (!reroll) {
    await query('UPDATE giveaways SET ended = TRUE WHERE id = $1', [giveaway.id]);
  }

  let channel;
  try {
    channel = await client.channels.fetch(giveaway.channel_id);
  } catch {
    log.warn(`Salon du giveaway #${giveaway.id} introuvable`);
    return;
  }

  // Met à jour le message d'origine (bouton désactivé).
  if (giveaway.message_id) {
    try {
      const message = await channel.messages.fetch(giveaway.message_id);
      await message.edit(
        buildGiveawayMessage({
          id: giveaway.id,
          prize: giveaway.prize,
          winners: giveaway.winners,
          endsAt: giveaway.ends_at,
          entries: entries.length,
          ended: true,
          vipOnly: giveaway.vip_only,
          conditions: giveaway.conditions,
        }),
      );
    } catch {
      // Message supprimé : on annonce quand même le résultat.
    }
  }

  if (entries.length === 0) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(COLORS.info)
        .setTitle('🎁 Giveaway terminé')
        .setDescription(`**${giveaway.prize}**\n\nAucun participant — pas de gagnant.`)],
    }).catch(() => {});
    return;
  }

  const winners = drawWinners(entries.map((e) => e.user_id), giveaway.winners);
  const mentions = winners.map((id) => `<@${id}>`).join(', ');

  await channel.send({
    content: mentions,
    embeds: [new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(reroll ? '🎲 Nouveau tirage !' : '🎉 Giveaway terminé !')
      .setDescription(
        `**Lot :** ${giveaway.prize}\n\n` +
        `**${winners.length > 1 ? 'Gagnants' : 'Gagnant'} :** ${mentions}\n\n` +
        `Félicitations ! Contacte un administrateur pour récupérer ton lot.`,
      )
      .setFooter({ text: `${entries.length} participant(s) · Giveaway #${giveaway.id}` })],
  }).catch((err) => log.warn(`Annonce du giveaway impossible : ${err.message}`));

  log.info(`Giveaway #${giveaway.id} terminé — ${winners.length} gagnant(s) sur ${entries.length} participants`);
}

/**
 * Boucle de vérification des giveaways arrivés à échéance.
 *
 * On interroge la base plutôt que d'utiliser setTimeout : un redémarrage
 * Railway effacerait tous les timers en mémoire, et les giveaways de
 * plusieurs jours ne se termineraient jamais.
 */
export function startGiveawayScheduler(client, intervalMs = 30_000) {
  const tick = async () => {
    try {
      const { rows } = await query(
        'SELECT * FROM giveaways WHERE ended = FALSE AND ends_at <= NOW()',
      );
      for (const giveaway of rows) {
        await endGiveaway(client, giveaway);
      }
    } catch (err) {
      log.error('Erreur dans le planificateur de giveaways', err);
    }
  };

  setInterval(tick, intervalMs).unref();
  tick(); // rattrape les giveaways expirés pendant un redémarrage
}
