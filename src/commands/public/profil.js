import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../../db/index.js';
import { buildProfileEmbed } from '../../lib/profileEmbed.js';
import { buildRankMenus } from '../../handlers/ranks.js';

export const data = new SlashCommandBuilder()
  .setName('profil')
  .setDescription('Affiche ton profil ou celui d\'un membre')
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

  const isSelf = target.id === interaction.user.id;
  const cfg = await getGuildConfig(interaction.guild.id);

  const embed = await buildProfileEmbed(interaction.guild, target, cfg, {
    // Le casier reste privé : visible par l'intéressé et les modérateurs.
    canSeeWarns: isSelf
      || interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers),
  });

  // Sur son propre profil, les menus de rang permettent de se mettre à
  // jour sans changer de salon.
  const components = isSelf ? buildRankMenus(cfg) : [];

  return interaction.reply({
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  });
}
