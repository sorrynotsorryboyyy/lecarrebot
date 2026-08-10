import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { sendLog } from './logs.js';

/**
 * Protection anti-raid.
 *
 * Deux signaux complémentaires :
 *   • Comptes trop récents  → un raid s'appuie presque toujours sur des
 *     comptes fraîchement créés en masse.
 *   • Vague d'arrivées      → N arrivées en moins de X secondes.
 *
 * L'historique des arrivées vit en mémoire : ce sont des données à durée de
 * vie de quelques secondes, les écrire en base coûterait plus cher que de
 * les reconstruire après un redémarrage.
 */

/** guildId → tableau d'horodatages d'arrivée (ms). */
const joinHistory = new Map();

/** Serveurs déjà en lockdown automatique, pour ne pas alerter en boucle. */
const lockdownNotified = new Set();

/** Purge les entrées hors fenêtre et renvoie le nombre d'arrivées récentes. */
function recordJoin(guildId, windowSeconds) {
  const now = Date.now();
  const cutoff = now - windowSeconds * 1000;

  const history = (joinHistory.get(guildId) ?? []).filter((t) => t > cutoff);
  history.push(now);
  joinHistory.set(guildId, history);

  return history.length;
}

/** Âge du compte, en jours. */
function accountAgeDays(user) {
  return (Date.now() - user.createdTimestamp) / 86_400_000;
}

/**
 * Appelé à chaque arrivée. Renvoie `true` si le membre a été expulsé,
 * afin que l'appelant s'abstienne de lui envoyer le message de bienvenue.
 */
export async function inspectJoin(member) {
  const cfg = await getGuildConfig(member.guild.id);
  if (!cfg.antiraid_enabled) return false;

  const age = accountAgeDays(member.user);

  // ─── Signal 1 : compte trop récent ───────────────────────────────
  if (age < cfg.antiraid_min_age) {
    const rounded = age < 1
      ? `${Math.round(age * 24)} heure(s)`
      : `${Math.floor(age)} jour(s)`;

    // En lockdown, on expulse. Hors lockdown, on se contente d'alerter :
    // un compte neuf est suspect, pas coupable.
    if (cfg.lockdown_active) {
      await notifyKick(member, `compte créé il y a ${rounded}`);
      await member.kick(`Anti-raid : compte trop récent (${rounded}) pendant un lockdown`)
        .catch((e) => log.warn(`Expulsion anti-raid impossible : ${e.message}`));

      await sendLog(member.guild, {
        color: COLORS.danger,
        title: '🛡️ Anti-raid — Membre expulsé',
        description: `${member.user} (\`${member.user.tag}\`) expulsé.\n**Motif :** compte créé il y a ${rounded} (lockdown actif).`,
      });
      return true;
    }

    await sendLog(member.guild, {
      color: COLORS.warning,
      title: '⚠️ Compte récent détecté',
      description: `${member.user} (\`${member.user.tag}\`) vient d'arriver.\n**Âge du compte :** ${rounded}\n\nAucune action automatique — surveillance recommandée.`,
    });
  }

  // ─── Signal 2 : vague d'arrivées ─────────────────────────────────
  const recent = recordJoin(member.guild.id, cfg.antiraid_window);

  if (recent >= cfg.antiraid_joins && !cfg.lockdown_active) {
    await triggerLockdown(member.guild, recent, cfg.antiraid_window);
  }

  return false;
}

/** Prévient le membre avant l'expulsion (le MP échoue souvent : sans importance). */
async function notifyKick(member, reason) {
  await member.send(
    `👋 Tu as été expulsé de **${member.guild.name}**.\n\n` +
    `**Motif :** ${reason}\n\n` +
    `Le serveur est actuellement en protection anti-raid. ` +
    `Tu peux réessayer plus tard — ce n'est pas un bannissement.`,
  ).catch(() => {});
}

/** Bascule le serveur en lockdown : plus aucune vérification n'est acceptée. */
export async function triggerLockdown(guild, joinCount, windowSeconds) {
  await updateGuildConfig(guild.id, { lockdown_active: true });

  log.warn(`🛡️ LOCKDOWN déclenché sur ${guild.name} — ${joinCount} arrivées en ${windowSeconds}s`);

  if (!lockdownNotified.has(guild.id)) {
    lockdownNotified.add(guild.id);

    await sendLog(guild, {
      color: COLORS.danger,
      title: '🚨 RAID DÉTECTÉ — Lockdown activé',
      description:
        `**${joinCount} arrivées** en moins de **${windowSeconds} secondes**.\n\n` +
        'Le serveur est passé en mode lockdown :\n' +
        '• Les nouvelles vérifications sont bloquées\n' +
        '• Les comptes récents sont expulsés automatiquement\n\n' +
        'Utilise `/lockdown off` pour désactiver une fois la vague passée.',
    });
  }
}

/** Sortie manuelle du lockdown. */
export async function liftLockdown(guild) {
  await updateGuildConfig(guild.id, { lockdown_active: false });
  lockdownNotified.delete(guild.id);
  joinHistory.delete(guild.id);

  await sendLog(guild, {
    color: COLORS.success,
    title: '✅ Lockdown désactivé',
    description: 'Le serveur est repassé en fonctionnement normal.',
  });

  log.info(`Lockdown levé sur ${guild.name}`);
}

/**
 * Verrouille l'écriture dans tous les salons textuels pour @everyone.
 * Utilisé par `/lockdown salons` — indépendant du lockdown anti-raid,
 * qui, lui, ne concerne que les arrivées.
 */
export async function setChannelsLocked(guild, locked) {
  const everyone = guild.roles.everyone;
  let changed = 0;

  const channels = await guild.channels.fetch();

  for (const channel of channels.values()) {
    if (!channel?.isTextBased() || channel.isThread()) continue;
    try {
      await channel.permissionOverwrites.edit(everyone, {
        [PermissionFlagsBits.SendMessages]: locked ? false : null,
      });
      changed++;
    } catch {
      // Salon hors de portée du bot : on continue sans bloquer les autres.
    }
  }

  return changed;
}
