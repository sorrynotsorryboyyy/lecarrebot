import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig, query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { buildRankMenus, readMemberRanks } from '../../handlers/ranks.js';

export const data = new SlashCommandBuilder()
  .setName('profil')
  .setDescription('Affiche ton profil ou celui d\'un membre')
  .addUserOption((o) =>
    o.setName('membre').setDescription('Le membre à consulter (toi par défaut)'));

export async function execute(interaction) {
  const target = interaction.options.getMember('membre') ?? interaction.member;
  const isSelf = target.id === interaction.user.id;

  if (!target) {
    return interaction.reply({
      content: '❌ Membre introuvable sur ce serveur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);
  const ranks = readMemberRanks(target, cfg);

  const [warns, verif, lfgCount] = await Promise.all([
    query(
      'SELECT COUNT(*)::int AS n FROM warnings WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, target.id],
    ),
    query(
      'SELECT verified_at FROM verifications WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, target.id],
    ),
    query(
      'SELECT COUNT(*)::int AS n FROM lfg_posts WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, target.id],
    ),
  ]);

  const verifiedAt = verif.rows[0]?.verified_at;
  const rankValue = (spec) => (spec ? `${spec.emoji} **${spec.name}**` : '*non renseigné*');

  const embed = new EmbedBuilder()
    .setColor(target.displayColor || COLORS.primary)
    .setAuthor({
      name: target.user.tag,
      iconURL: target.user.displayAvatarURL(),
    })
    .setThumbnail(target.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '🎯 Rang Premier', value: rankValue(ranks.premier), inline: true },
      { name: '⚡ Niveau Faceit', value: rankValue(ranks.faceit), inline: true },
      { name: '​', value: '​', inline: true },
      {
        name: '📅 Arrivé',
        value: target.joinedTimestamp
          ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>`
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
      { name: '🎮 Annonces LFG', value: `${lfgCount.rows[0].n}`, inline: true },
    )
    .setFooter({ text: `Membre de ${interaction.guild.name}` });

  // Les avertissements ne sont montrés qu'à l'intéressé et aux modérateurs :
  // afficher publiquement le casier d'un membre serait une mise au pilori.
  const canSeeWarns = isSelf || interaction.memberPermissions?.has('ModerateMembers');
  if (canSeeWarns && warns.rows[0].n > 0) {
    embed.addFields({
      name: '⚠️ Avertissements',
      value: `${warns.rows[0].n}`,
      inline: true,
    });
  }

  // Sur son propre profil, on propose les menus de rang : c'est le point
  // d'entrée le plus naturel pour changer de rang après une montée.
  const components = isSelf ? buildRankMenus(cfg) : [];

  return interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });
}
