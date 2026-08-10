import { PermissionFlagsBits } from 'discord.js';
import { query } from '../db/index.js';
import { log } from '../lib/logger.js';

/**
 * Suivi des invitations — qui a fait venir qui.
 *
 * Discord ne dit jamais quelle invitation un arrivant a utilisée. La seule
 * méthode fiable consiste à garder en mémoire le compteur d'usages de chaque
 * invitation, puis à comparer à la première arrivée suivante : celle dont le
 * compteur a bougé est la bonne.
 *
 * Le cache vit en mémoire parce qu'il n'a de sens qu'entre deux arrivées.
 * L'attribution, elle, est écrite en base — c'est elle qui doit survivre aux
 * redéploiements pour que le total « X invitations » reste juste.
 */

/** guildId → Map(code → usages) */
const cache = new Map();

/**
 * Recharge le compteur d'un serveur.
 * Silencieux en cas d'échec : sans la permission « Gérer le serveur », le
 * suivi est simplement indisponible et le reste du bot continue.
 */
export async function refreshGuildInvites(guild) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return false;
  }

  try {
    const invites = await guild.invites.fetch();
    const counts = new Map();
    for (const invite of invites.values()) counts.set(invite.code, invite.uses ?? 0);

    // L'invitation permanente du serveur (vanity URL) n'apparaît pas dans
    // cette liste : on la suit à part quand elle existe.
    if (guild.vanityURLCode) {
      const vanity = await guild.fetchVanityData().catch(() => null);
      if (vanity) counts.set(`vanity:${guild.vanityURLCode}`, vanity.uses ?? 0);
    }

    cache.set(guild.id, counts);
    return true;
  } catch (err) {
    log.debug(`Invitations non lues sur ${guild.name} : ${err.message}`);
    return false;
  }
}

/** Amorce le cache pour tous les serveurs au démarrage. */
export async function primeInviteCache(client) {
  for (const guild of client.guilds.cache.values()) {
    await refreshGuildInvites(guild);
  }
}

/**
 * Détermine qui a invité un arrivant, enregistre l'attribution et renvoie
 * le parrain avec son total.
 *
 * Renvoie `null` quand l'origine est indéterminable : invitation supprimée
 * entre-temps, permission manquante, ou plusieurs arrivées simultanées.
 */
export async function resolveInviter(member) {
  const guild = member.guild;
  const before = cache.get(guild.id);

  // Quoi qu'il arrive, le cache doit refléter l'état APRÈS cette arrivée.
  const after = await readInvites(guild);
  if (after) cache.set(guild.id, after);

  if (!before || !after) return null;

  // L'invitation dont le compteur a augmenté est celle qui a été utilisée.
  const used = [];
  for (const [code, uses] of after) {
    const previous = before.get(code) ?? 0;
    if (uses > previous) used.push(code);
  }

  // Zéro : invitation supprimée juste après usage, ou arrivée via une source
  // non suivie. Plusieurs : deux arrivées dans le même intervalle, on ne peut
  // pas trancher — mieux vaut ne rien afficher qu'attribuer à tort.
  if (used.length !== 1) return null;

  const inviterId = await inviterOf(guild, used[0]);
  if (!inviterId || inviterId === member.id) return null;

  const total = await recordInvite(guild.id, inviterId, member.id);
  return { inviterId, total };
}

/** Lit les compteurs courants sans toucher au cache. */
async function readInvites(guild) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return null;
  }

  try {
    const invites = await guild.invites.fetch();
    const counts = new Map();
    for (const invite of invites.values()) counts.set(invite.code, invite.uses ?? 0);

    if (guild.vanityURLCode) {
      const vanity = await guild.fetchVanityData().catch(() => null);
      if (vanity) counts.set(`vanity:${guild.vanityURLCode}`, vanity.uses ?? 0);
    }

    return counts;
  } catch {
    return null;
  }
}

/** Retrouve l'auteur d'une invitation à partir de son code. */
async function inviterOf(guild, code) {
  // La vanity URL n'appartient à personne : elle est au serveur.
  if (code.startsWith('vanity:')) return null;

  const invites = await guild.invites.fetch().catch(() => null);
  return invites?.get(code)?.inviter?.id ?? null;
}

/**
 * Enregistre l'attribution et renvoie le total du parrain.
 *
 * `ON CONFLICT DO NOTHING` sur l'arrivant : un membre qui part et revient ne
 * doit pas gonfler le compteur de son parrain une seconde fois.
 */
async function recordInvite(guildId, inviterId, memberId) {
  await query(
    `INSERT INTO invite_credits (guild_id, inviter_id, member_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (guild_id, member_id) DO NOTHING`,
    [guildId, inviterId, memberId],
  );

  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM invite_credits WHERE guild_id = $1 AND inviter_id = $2',
    [guildId, inviterId],
  );

  return rows[0]?.total ?? 0;
}

/** Nombre d'invitations validées d'un membre. Utilisé par /profil. */
export async function countInvites(guildId, userId) {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS total FROM invite_credits WHERE guild_id = $1 AND inviter_id = $2',
    [guildId, userId],
  );

  return rows[0]?.total ?? 0;
}

/** Retrouve le parrain enregistré d'un membre, s'il en a un. */
export async function inviterOfMember(guildId, memberId) {
  const { rows } = await query(
    'SELECT inviter_id FROM invite_credits WHERE guild_id = $1 AND member_id = $2',
    [guildId, memberId],
  );

  return rows[0]?.inviter_id ?? null;
}

/** Classement des parrains, pour le staff. */
export async function inviteLeaderboard(guildId, limit = 10) {
  const { rows } = await query(
    `SELECT inviter_id, COUNT(*)::int AS total
       FROM invite_credits
      WHERE guild_id = $1
      GROUP BY inviter_id
      ORDER BY total DESC
      LIMIT $2`,
    [guildId, limit],
  );

  return rows;
}
