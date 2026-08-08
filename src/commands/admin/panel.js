import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { buildPanelMenu } from '../../handlers/panel.js';

export const data = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Panel de publication — annonces, news, vote')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  // Pas de deferReply : la suite ouvre un formulaire, et showModal() ne
  // peut pas suivre une réponse différée.
  return interaction.reply({
    ...buildPanelMenu(),
    flags: MessageFlags.Ephemeral,
  });
}
