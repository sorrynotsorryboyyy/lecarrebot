import { EmbedBuilder } from 'discord.js';
import { COLORS } from './config.js';
import { query } from '../db/index.js';
import { readMemberIdentity, readMemberRanks } from '../handlers/ranks.js';
import { levelProgress, readRank, readXp } from '../handlers/xp.js';

/**
 * Fiche de profil, partagée par la commande /profil et le panneau du
 * salon #📇-profil — une seule mise en forme à maintenir.
 */
export async function buildProfileEmbed(guild, member, cfg, { canSeeWarns = false } = {}) {
  const ranks = readMemberRanks(member, cfg);
  const identity = readMemberIdentity(member, cfg);

  const [warns, verif, lfgCount, xpStats] = await Promise.all([
    query(
      'SELECT COUNT(*)::int AS n FROM warnings WHERE guild_id = $1 AND user_id = $2',
      [guild.id, member.id],
    ),
    query(
      'SELECT verified_at FROM verifications WHERE guild_id = $1 AND user_id = $2',
      [guild.id, member.id],
    ),
    query(
      'SELECT COUNT(*)::int AS n FROM lfg_posts WHERE guild_id = $1 AND user_id = $2',
      [guild.id, member.id],
    ),
    readXp(guild.id, member.id),
  ]);

  const xp = Number(xpStats.xp ?? 0);
  const progress = levelProgress(xp);
  const rank = await readRank(guild.id, member.id);
  const verifiedAt = verif.rows[0]?.verified_at;

  const isVip = cfg.vip_role_id && member.roles.cache.has(cfg.vip_role_id);
  const show = (spec) => (spec ? `${spec.emoji} **${spec.name}**` : '*non renseigné*');

  const embed = new EmbedBuilder()
    .setColor(member.displayColor || COLORS.primary)
    .setAuthor({
      name: `${member.user.tag}${isVip ? ' 💎' : ''}`,
      iconURL: member.user.displayAvatarURL(),
    })
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '🎯 Rang Premier', value: show(ranks.premier), inline: true },
      { name: '⚡ Niveau Faceit', value: show(ranks.faceit), inline: true },
      { name: '​', value: '​', inline: true },
      {
        name: '📊 Niveau',
        value: `**${progress.level}** · ${xp.toLocaleString('fr-FR')} XP${rank ? ` (#${rank})` : ''}`,
        inline: true,
      },
      {
        name: '📅 Arrivé',
        value: member.joinedTimestamp
          ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
          : '*inconnu*',
        inline: true,
      },
      {
        name: '🔐 Vérifié',
        value: verifiedAt
          ? `<t:${Math.floor(new Date(verifiedAt).getTime() / 1000)}:R>`
          : '❌ non',
        inline: true,
      },
    );

  // Bloc identité, seulement si le membre a renseigné quelque chose : un
  // champ « non renseigné » partout n'apporterait rien.
  const styles = (identity.playstyle ?? []).map((s) => `${s.emoji} ${s.name}`).join(' · ');
  const identityLine = [
    identity.age ? `${identity.age.emoji} ${identity.age.name}` : null,
    identity.gender ? `${identity.gender.emoji} ${identity.gender.name}` : null,
    styles || null,
  ].filter(Boolean).join(' · ');

  if (identityLine) {
    embed.addFields({ name: '🧩 À propos', value: identityLine });
  }

  const hours = Math.floor((xpStats.voice_minutes ?? 0) / 60);
  embed.addFields({
    name: '📈 Activité',
    value:
      `💬 ${xpStats.messages ?? 0} messages · ` +
      `🔊 ${hours}h de vocal · ` +
      `🎮 ${lfgCount.rows[0].n} recherche(s)`,
  });

  if (isVip) {
    embed.addFields({ name: '💎 Statut', value: '**Elite (VIP)**', inline: true });
  }

  // Le casier n'est montré qu'à l'intéressé et aux modérateurs : afficher
  // publiquement les avertissements d'un membre serait une mise au pilori.
  if (canSeeWarns && warns.rows[0].n > 0) {
    embed.addFields({
      name: '⚠️ Avertissements',
      value: `${warns.rows[0].n}`,
      inline: true,
    });
  }

  return embed.setFooter({ text: `Membre de ${guild.name}` });
}
