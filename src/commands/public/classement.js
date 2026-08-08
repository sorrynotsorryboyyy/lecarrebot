import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildLeaderboardEmbed } from '../../lib/xpEmbed.js';

export const data = new SlashCommandBuilder()
  .setName('classement')
  .setDescription('Les membres les plus actifs du serveur')
  .addIntegerOption((o) =>
    o.setName('nombre')
      .setDescription('Combien de membres afficher (défaut : 10)')
      .setMinValue(3)
      .setMaxValue(25));

export async function execute(interaction) {
  const limit = interaction.options.getInteger('nombre') ?? 10;
  const embed = await buildLeaderboardEmbed(interaction.guild, limit);

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
