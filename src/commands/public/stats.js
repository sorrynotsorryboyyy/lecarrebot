import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig, query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { RANK_SERIES } from '../../lib/ranks.js';
import { parseRankRoles } from '../../handlers/ranks.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Répartition des rangs et activité de la communauté');

export async function execute(interaction) {
  // Le comptage exige un cache membres complet, ce qui dépasse les 3s.
  await interaction.deferReply();

  const guild = interaction.guild;

  // `role.members` ne reflète que les membres en cache. L'intent
  // GuildMembers est actif, mais le cache peut être partiel après un
  // redémarrage : un fetch explicite garantit un comptage exact.
  await guild.members.fetch();

  const cfg = await getGuildConfig(guild.id);
  const map = parseRankRoles(cfg.rank_roles);

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`📊 Statistiques — ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }));

  const ranked = new Set();

  for (const series of Object.values(RANK_SERIES)) {
    const counts = series.ranks.map((spec) => {
      const role = map[spec.key] ? guild.roles.cache.get(map[spec.key]) : null;
      if (role) for (const id of role.members.keys()) ranked.add(id);
      return { spec, n: role?.members.size ?? 0 };
    });

    const total = counts.reduce((s, c) => s + c.n, 0);
    if (total === 0) {
      embed.addFields({
        name: series.label,
        value: '*Aucun membre n\'a encore choisi son rang.*',
      });
      continue;
    }

    // Barre proportionnelle en blocs : lisible partout, sans dépendance
    // graphique ni image à générer.
    const lines = counts.map(({ spec, n }) => {
      const filled = Math.round((n / total) * 10);
      return `${spec.emoji} \`${spec.name.padEnd(11)}\` ${'█'.repeat(filled)}${'░'.repeat(10 - filled)} **${n}**`;
    });

    embed.addFields({
      name: `${series.label} — ${total} membre(s)`,
      value: lines.join('\n'),
    });
  }

  // Chiffres du serveur, avec la part non renseignée affichée honnêtement.
  const [verified, lfg] = await Promise.all([
    query(
      'SELECT COUNT(*)::int AS n FROM verifications WHERE guild_id = $1 AND verified_at IS NOT NULL',
      [guild.id],
    ),
    query('SELECT COUNT(*)::int AS n FROM lfg_posts WHERE guild_id = $1', [guild.id]),
  ]);

  const humans = guild.members.cache.filter((m) => !m.user.bot).size;

  embed.addFields({
    name: '🌍 Communauté',
    value:
      `👥 Membres : **${humans}**\n` +
      `🔐 Vérifiés : **${verified.rows[0].n}**\n` +
      `🎭 Rang renseigné : **${ranked.size}** *(${humans - ranked.size} sans rang)*\n` +
      `🎮 Annonces LFG publiées : **${lfg.rows[0].n}**`,
  });

  embed.setFooter({ text: 'Choisis ton rang dans #🎭-roles' }).setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
