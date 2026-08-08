import { EmbedBuilder } from 'discord.js';
import { COLORS } from './config.js';
import { levelProgress, readLeaderboard, readRank, readXp } from '../handlers/xp.js';

/** Barre de progression en blocs — lisible partout, sans image à générer. */
function progressBar(ratio, width = 12) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/** Fiche d'XP d'un membre. */
export async function buildXpEmbed(guild, member) {
  const stats = await readXp(guild.id, member.id);
  const xp = Number(stats.xp ?? 0);
  const progress = levelProgress(xp);
  const rank = await readRank(guild.id, member.id);

  const hours = Math.floor((stats.voice_minutes ?? 0) / 60);
  const minutes = (stats.voice_minutes ?? 0) % 60;

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setAuthor({
      name: `Progression de ${member.displayName}`,
      iconURL: member.user.displayAvatarURL(),
    })
    .setDescription(
      `### Niveau ${progress.level}\n` +
      `\`${progressBar(progress.ratio)}\` **${progress.current}** / ${progress.needed} XP\n\n` +
      `Encore **${progress.needed - progress.current} XP** pour le niveau ${progress.level + 1}.`,
    )
    .addFields(
      { name: '⭐ XP total', value: `${xp.toLocaleString('fr-FR')}`, inline: true },
      { name: '🏆 Classement', value: rank ? `#${rank}` : '—', inline: true },
      { name: '​', value: '​', inline: true },
      { name: '💬 Messages', value: `${stats.messages ?? 0}`, inline: true },
      {
        name: '🔊 Temps vocal',
        value: hours > 0 ? `${hours}h ${minutes}min` : `${minutes} min`,
        inline: true,
      },
      { name: '🎮 Recherches', value: `${stats.searches ?? 0}`, inline: true },
    )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
}

/** Classement des membres les plus actifs. */
export async function buildLeaderboardEmbed(guild, limit = 10) {
  const rows = await readLeaderboard(guild.id, limit);

  if (rows.length === 0) {
    return new EmbedBuilder()
      .setColor(COLORS.info)
      .setTitle('🏆 Classement')
      .setDescription('Personne n\'a encore gagné d\'XP. À vous de jouer !');
  }

  const medals = ['🥇', '🥈', '🥉'];

  const lines = rows.map((row, i) => {
    const place = medals[i] ?? `\`#${String(i + 1).padStart(2, ' ')}\``;
    const xp = Number(row.xp).toLocaleString('fr-FR');
    return `${place} <@${row.user_id}> — **niv. ${row.level}** · ${xp} XP`;
  });

  return new EmbedBuilder()
    .setColor(COLORS.warning)
    .setTitle(`🏆 Classement — ${guild.name}`)
    .setDescription(lines.join('\n'))
    .setThumbnail(guild.iconURL({ size: 256 }))
    .setFooter({ text: 'XP gagnée en discutant, en vocal et via /recherche.' })
    .setTimestamp();
}
