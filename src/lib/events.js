import { query } from '../db/index.js';
import { buildGiveawayMessage, buildTournamentMessage } from './embeds.js';
import { sendPublication } from './publication.js';

/**
 * Création des objets « vivants » : tournois et giveaways.
 *
 * Ces deux-là existaient en trois exemplaires — `/tournoi créer`,
 * `/giveaway lancer` et le formulaire du panneau — avec des divergences
 * réelles : le panneau forçait le format « 5v5 » et perdait l'option
 * réservée aux Elite. Un seul chemin ici, appelé par les trois.
 *
 * Le message est publié PUIS son identifiant réécrit en base : l'ordre
 * inverse est impossible, l'identifiant n'existe pas avant l'envoi.
 */

/**
 * Crée un tournoi et publie son annonce.
 * @returns { id, message }
 */
export async function createTournament({
  guildId, channel, name, description = null, format = '5v5',
  maxTeams = null, startsAt, createdBy,
  imageUrl = null, mention = null, publicSignupsAt = null,
}) {
  const { rows } = await query(
    `INSERT INTO tournaments
       (guild_id, channel_id, name, description, format, max_teams,
        starts_at, created_by, image_url, public_signups_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      guildId, channel.id, name, description, format, maxTeams,
      startsAt, createdBy, imageUrl, publicSignupsAt,
    ],
  );

  const id = rows[0].id;

  const built = buildTournamentMessage({
    id, name, description, format, maxTeams, startsAt,
    signups: [], status: 'open', imageUrl, publicSignupsAt,
  });

  const message = await sendPublication(
    channel,
    { ...built.publication, mention },
    { components: built.components },
  );

  await query('UPDATE tournaments SET message_id = $2 WHERE id = $1', [id, message.id]);

  return { id, message };
}

/**
 * Crée un giveaway et publie son annonce.
 * @returns { id, message }
 */
export async function createGiveaway({
  guildId, channel, prize, winners = 1, endsAt, createdBy,
  vipOnly = false, conditions = null, imageUrl = null, mention = null,
}) {
  const { rows } = await query(
    `INSERT INTO giveaways
       (guild_id, channel_id, prize, winners, ends_at, created_by,
        vip_only, conditions, image_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [guildId, channel.id, prize, winners, endsAt, createdBy, vipOnly, conditions, imageUrl],
  );

  const id = rows[0].id;

  const built = buildGiveawayMessage({
    id, prize, winners, endsAt, entries: 0, ended: false,
    vipOnly, conditions, imageUrl,
  });

  const message = await sendPublication(
    channel,
    { ...built.publication, mention },
    { components: built.components },
  );

  await query('UPDATE giveaways SET message_id = $2 WHERE id = $1', [id, message.id]);

  return { id, message };
}
