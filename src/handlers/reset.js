import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { query } from '../db/index.js';
import { log } from '../lib/logger.js';

/**
 * Remise à zéro complète du serveur.
 *
 * Opération IRRÉVERSIBLE : les salons supprimés emportent tout leur
 * historique, et Discord ne propose aucune restauration. D'où la double
 * confirmation côté commande, et les protections ci-dessous qui empêchent
 * le bot de se saborder lui-même en cours de route.
 */

/**
 * Supprime salons et catégories — jamais les rôles.
 *
 * Les rôles sont volontairement épargnés : sur un serveur actif ils sont
 * portés par des membres, et les supprimer ferait perdre à chacun son
 * rang, son identité et son statut. `/setup` les réadopte ensuite par
 * leur nom et se contente de les réordonner.
 *
 * `keepChannelId` échappe le salon d'où la commande a été lancée : le
 * supprimer ferait disparaître l'interaction avant qu'on ait pu rendre
 * compte du résultat.
 */
export async function wipeGuild(guild, { keepChannelId } = {}) {
  const result = { channels: 0, categories: 0, roles: 0, failed: [] };

  await guild.channels.fetch();

  // ─── Salons, catégories en dernier ─────────────────────────────
  // Supprimer une catégorie ne supprime pas ses salons, mais l'ordre
  // garde des logs lisibles et évite des salons temporairement orphelins.
  const channels = [...guild.channels.cache.values()]
    .filter((c) => c.id !== keepChannelId)
    .sort((a, b) => {
      const aCat = a.type === ChannelType.GuildCategory ? 1 : 0;
      const bCat = b.type === ChannelType.GuildCategory ? 1 : 0;
      return aCat - bCat;
    });

  for (const channel of channels) {
    try {
      const isCategory = channel.type === ChannelType.GuildCategory;
      await channel.delete('CarréBot — remise à zéro du serveur');
      if (isCategory) result.categories++;
      else result.channels++;
    } catch (err) {
      result.failed.push(`salon **${channel.name}** : ${err.message}`);
    }
  }

  // Aucun rôle n'est supprimé : les membres conservent rang, identité,
  // VIP et Membre. /setup les réadopte par leur nom au prochain passage.
  return result;
}

/**
 * Efface toutes les données du serveur en base.
 *
 * L'ordre importe : les tables liées par clé étrangère sont purgées via
 * ON DELETE CASCADE, mais on supprime explicitement pour rester lisible.
 */
export async function wipeData(guildId) {
  const tables = [
    'temp_voice_channels',
    'vip_members',
    'strats',
    'warnings',
    'verifications',
    'tickets',
    'stats_cache',
    'member_links',
    'publications',   // brouillons et publications programmées
    'lfg_posts',      // lfg_joins suit en cascade
    'tournaments',    // tournament_signups suit en cascade
    'giveaways',      // giveaway_entries suit en cascade
    'guild_config',
  ];

  // `invite_credits` n'est PAS purgée : au même titre que les rôles, elle
  // porte un acquis des membres — le nombre de personnes qu'ils ont fait
  // venir. Une refonte des salons n'a aucune raison de l'effacer.

  let cleared = 0;

  for (const table of tables) {
    try {
      const { rowCount } = await query(`DELETE FROM ${table} WHERE guild_id = $1`, [guildId]);
      cleared += rowCount;
    } catch (err) {
      log.warn(`Purge de ${table} impossible : ${err.message}`);
    }
  }

  return cleared;
}

/**
 * Vérifie que le bot peut mener l'opération à bien.
 * Renvoie un message d'erreur, ou null si tout est en ordre.
 */
export function checkResetPermissions(guild) {
  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return 'Il me faut la permission **Gérer les salons**.';
  }
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return 'Il me faut la permission **Gérer les rôles**.';
  }

  return null;
}
