import { EmbedBuilder } from 'discord.js';
import { query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';

/**
 * Expérience et niveaux.
 *
 * Trois sources : messages, temps vocal réel, annonces de recherche.
 * Chacune est bornée pour qu'aucune ne récompense le spam — l'XP doit
 * refléter une présence réelle, pas une capacité à automatiser.
 */

/** Délai minimal entre deux gains d'XP par message (anti-flood). */
const MESSAGE_COOLDOWN_MS = 60_000;

/** Délai minimal entre deux annonces /recherche comptabilisées. */
const SEARCH_COOLDOWN_MS = 10 * 60_000;

const MESSAGE_XP = { min: 15, max: 25 };
const VOICE_XP_PER_MINUTE = 10;
const SEARCH_XP = 50;

/**
 * XP cumulée nécessaire pour atteindre un niveau.
 * Courbe classique 5n² + 50n + 100 : la progression ralentit doucement,
 * sans jamais devenir décourageante.
 */
export function xpForLevel(level) {
  let total = 0;
  for (let n = 0; n < level; n++) total += 5 * n * n + 50 * n + 100;
  return total;
}

/** Niveau correspondant à une quantité d'XP. */
export function levelFromXp(xp) {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

/** Progression vers le niveau suivant, pour l'affichage. */
export function levelProgress(xp) {
  const level = levelFromXp(xp);
  const current = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return {
    level,
    current: xp - current,
    needed: next - current,
    ratio: (xp - current) / (next - current),
  };
}

/**
 * Ajoute de l'XP et détecte une montée de niveau.
 * Renvoie { level, leveled } — `leveled` vaut true au franchissement.
 */
async function addXp(guildId, userId, amount) {
  const { rows } = await query(
    `INSERT INTO member_xp (guild_id, user_id, xp, level)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET xp = member_xp.xp + $3
     RETURNING xp, level`,
    [guildId, userId, amount],
  );

  const { xp, level: storedLevel } = rows[0];
  const level = levelFromXp(Number(xp));

  if (level !== storedLevel) {
    await query(
      'UPDATE member_xp SET level = $3 WHERE guild_id = $1 AND user_id = $2',
      [guildId, userId, level],
    );
  }

  return { xp: Number(xp), level, leveled: level > storedLevel };
}

/** XP de message, avec délai anti-flood. */
export async function grantMessageXp(message, cfg) {
  const guildId = message.guild.id;
  const userId = message.author.id;

  const { rows } = await query(
    'SELECT last_message_at FROM member_xp WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId],
  );

  const last = rows[0]?.last_message_at;
  if (last && Date.now() - new Date(last).getTime() < MESSAGE_COOLDOWN_MS) {
    return; // Trop tôt : le spam ne rapporte rien.
  }

  const amount = MESSAGE_XP.min
    + Math.floor(Math.random() * (MESSAGE_XP.max - MESSAGE_XP.min + 1));

  await query(
    `INSERT INTO member_xp (guild_id, user_id, xp, messages, last_message_at)
     VALUES ($1, $2, 0, 0, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET messages = member_xp.messages + 1, last_message_at = NOW()`,
    [guildId, userId],
  );

  const result = await addXp(guildId, userId, amount);
  if (result.leveled) await announceLevelUp(message.guild, message.member, result, cfg);
}

/** XP de temps vocal, calculée à la déconnexion. */
export async function grantVoiceXp(guild, member, minutes, cfg) {
  if (minutes < 1) return;

  const amount = Math.floor(minutes) * VOICE_XP_PER_MINUTE;

  await query(
    `INSERT INTO member_xp (guild_id, user_id, xp, voice_minutes)
     VALUES ($1, $2, 0, $3)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET voice_minutes = member_xp.voice_minutes + $3`,
    [guild.id, member.id, Math.floor(minutes)],
  );

  const result = await addXp(guild.id, member.id, amount);
  if (result.leveled) await announceLevelUp(guild, member, result, cfg);
}

/** XP d'annonce /recherche, avec délai pour éviter le spam d'annonces. */
export async function grantSearchXp(guild, member, cfg) {
  const { rows } = await query(
    'SELECT last_search_at FROM member_xp WHERE guild_id = $1 AND user_id = $2',
    [guild.id, member.id],
  );

  const last = rows[0]?.last_search_at;
  if (last && Date.now() - new Date(last).getTime() < SEARCH_COOLDOWN_MS) return;

  await query(
    `INSERT INTO member_xp (guild_id, user_id, xp, searches, last_search_at)
     VALUES ($1, $2, 0, 1, NOW())
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET searches = member_xp.searches + 1, last_search_at = NOW()`,
    [guild.id, member.id],
  );

  const result = await addXp(guild.id, member.id, SEARCH_XP);
  if (result.leveled) await announceLevelUp(guild, member, result, cfg);
}

/** Annonce une montée de niveau dans le salon XP. */
async function announceLevelUp(guild, member, result, cfg) {
  const channelIds = parseJsonColumn(cfg?.channel_ids);
  const channelId = channelIds.xp;
  if (!channelId || !member) return;

  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setDescription(
        `🎉 ${member} passe **niveau ${result.level}** !`,
      )
      .setThumbnail(member.user.displayAvatarURL({ size: 128 }));

    await channel.send({ embeds: [embed] });
  } catch (err) {
    log.debug(`Annonce de niveau impossible : ${err.message}`);
  }
}

/** Lit la fiche d'XP d'un membre. */
export async function readXp(guildId, userId) {
  const { rows } = await query(
    'SELECT * FROM member_xp WHERE guild_id = $1 AND user_id = $2',
    [guildId, userId],
  );

  return rows[0] ?? {
    xp: 0, level: 0, messages: 0, voice_minutes: 0, searches: 0,
  };
}

/** Classement des membres les plus actifs. */
export async function readLeaderboard(guildId, limit = 10) {
  const { rows } = await query(
    `SELECT user_id, xp, level, messages, voice_minutes
     FROM member_xp WHERE guild_id = $1 AND xp > 0
     ORDER BY xp DESC LIMIT $2`,
    [guildId, limit],
  );
  return rows;
}

/** Rang d'un membre dans le classement (1 = premier). */
export async function readRank(guildId, userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int + 1 AS rank FROM member_xp
     WHERE guild_id = $1 AND xp > (
       SELECT COALESCE(xp, 0) FROM member_xp WHERE guild_id = $1 AND user_id = $2
     )`,
    [guildId, userId],
  );
  return rows[0]?.rank ?? null;
}
