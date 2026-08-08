import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { buildXpEmbed } from '../../lib/xpEmbed.js';

export const data = new SlashCommandBuilder()
  .setName('xp')
  .setDescription('Affiche ton niveau et ta progression')
  .addUserOption((o) =>
    o.setName('membre').setDescription('Le membre à consulter (toi par défaut)'));

export async function execute(interaction) {
  const target = interaction.options.getMember('membre') ?? interaction.member;

  if (!target) {
    return interaction.reply({
      content: '❌ Membre introuvable sur ce serveur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = await buildXpEmbed(interaction.guild, target);
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
