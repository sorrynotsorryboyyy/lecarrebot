import { EmbedBuilder, MessageFlags } from 'discord.js';
import { query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { buildGiveawayMessage, toMessage } from '../lib/embeds.js';
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
        '💎 Ce giveaway est réservé aux membres **Elite**.\n\n' +
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
      toMessage(buildGiveawayMessage({
        id: g.id,
        prize: g.prize,
        winners: g.winners,
        endsAt: g.ends_at,
        entries: count[0].n,
        ended: g.ended,
        vipOnly: g.vip_only,
        conditions: g.conditions,
        imageUrl: g.image_url,
      })),
    );
  } catch (err) {
    log.debug(`Mise à jour du giveaway #${giveawayId} impossible : ${err.message}`);
  }
}

/** Poids d'un participant dans le tirage. Les Elite comptent double. */
const ELITE_WEIGHT = 2;

/**
 * Tire au sort `n` gagnants DISTINCTS parmi les participants.
 *
 * Les Elite voient leurs chances doublées. La pondération se fait ici, au
 * tirage, et non en base : `giveaway_entries` a une clé primaire sur
 * (giveaway_id, user_id), une seconde inscription y est donc impossible —
 * et c'est très bien ainsi, un participant reste un participant.
 *
 * On retire le gagnant par valeur après chaque tirage, et non par index :
 * un Elite figure plusieurs fois dans le vivier, un `splice` ne supprimerait
 * qu'une de ses occurrences et il pourrait gagner deux fois.
 */
function drawWinners(userIds, n, eliteIds = new Set()) {
  let pool = userIds.flatMap((id) =>
    (eliteIds.has(id) ? Array(ELITE_WEIGHT).fill(id) : [id]));

  const winners = [];

  while (winners.length < n && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const winner = pool[idx];
    winners.push(winner);
    pool = pool.filter((id) => id !== winner);
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
        toMessage(buildGiveawayMessage({
          id: giveaway.id,
          prize: giveaway.prize,
          winners: giveaway.winners,
          endsAt: giveaway.ends_at,
          entries: entries.length,
          ended: true,
          vipOnly: giveaway.vip_only,
          conditions: giveaway.conditions,
          imageUrl: giveaway.image_url,
        })),
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

  // Les Elite en une seule requête : un appel par participant ferait autant
  // d'allers-retours en base qu'il y a d'inscrits.
  const { rows: elites } = await query(
    `SELECT user_id FROM vip_members
      WHERE guild_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [giveaway.guild_id],
  );
  const eliteIds = new Set(elites.map((e) => e.user_id));

  const winners = drawWinners(entries.map((e) => e.user_id), giveaway.winners, eliteIds);
  const mentions = winners.map((id) => `<@${id}>`).join(', ');

  // Un tirage pondéré qu'on ne montre pas passe pour un tirage truqué : on
  // l'annonce dès qu'au moins un Elite a participé.
  const weighted = entries.some((e) => eliteIds.has(e.user_id));

  await channel.send({
    content: mentions,
    embeds: [new EmbedBuilder()
      .setColor(COLORS.success)
      .setTitle(reroll ? '🎲 Nouveau tirage !' : '🎉 Giveaway terminé !')
      .setDescription(
        `**Lot :** ${giveaway.prize}\n\n` +
        `**${winners.length > 1 ? 'Gagnants' : 'Gagnant'} :** ${mentions}\n\n` +
        (weighted ? '💎 *Les membres Elite avaient une chance doublée.*\n\n' : '') +
        'Félicitations ! Contacte un administrateur pour récupérer ton lot.',
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
