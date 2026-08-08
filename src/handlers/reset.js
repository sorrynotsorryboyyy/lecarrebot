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
 * Un rôle est-il protégé de la suppression ?
 *
 * Trois cas où supprimer casserait le serveur ou échouerait :
 *   • @everyone — ne peut pas être supprimé, c'est le rôle de base ;
 *   • les rôles gérés (bots, boosts, intégrations) — Discord refuse ;
 *   • les rôles au-dessus du bot — hors de sa portée.
 *
 * Le rôle du bot lui-même est également conservé : le supprimer lui
 * retirerait ses permissions au milieu du nettoyage.
 */
export function isRoleProtected(role, me) {
  if (role.id === role.guild.roles.everyone.id) return true;
  if (role.managed) return true;
  if (me.roles.cache.has(role.id)) return true;
  return role.position >= me.roles.highest.position;
}

/**
 * Supprime salons, catégories et rôles du serveur.
 *
 * `keepChannelId` échappe le salon d'où la commande a été lancée : le
 * supprimer ferait disparaître l'interaction avant qu'on ait pu rendre
 * compte du résultat. Il est supprimé en dernier par l'appelant si besoin.
 */
export async function wipeGuild(guild, { keepChannelId } = {}) {
  const me = guild.members.me;
  const result = { channels: 0, categories: 0, roles: 0, failed: [] };

  await guild.channels.fetch();
  await guild.roles.fetch();

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

  // ─── Rôles ─────────────────────────────────────────────────────
  // Du plus bas au plus haut : supprimer un rôle ne change pas la portée
  // du bot, mais l'ordre évite les erreurs de hiérarchie en cascade.
  const roles = [...guild.roles.cache.values()]
    .filter((r) => !isRoleProtected(r, me))
    .sort((a, b) => a.position - b.position);

  for (const role of roles) {
    try {
      await role.delete('CarréBot — remise à zéro du serveur');
      result.roles++;
    } catch (err) {
      result.failed.push(`rôle **${role.name}** : ${err.message}`);
    }
  }

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
    'member_xp',
    'temp_voice_channels',
    'vip_members',
    'strats',
    'warnings',
    'verifications',
    'lfg_posts',      // lfg_joins suit en cascade
    'tournaments',    // tournament_signups suit en cascade
    'giveaways',      // giveaway_entries suit en cascade
    'guild_config',
  ];

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
