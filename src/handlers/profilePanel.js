import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { buildProfileEmbed } from '../lib/profileEmbed.js';
import { buildXpEmbed, buildLeaderboardEmbed } from '../lib/xpEmbed.js';

/**
 * Panneau permanent du salon #📇-profil.
 *
 * Évite d'avoir à retenir des commandes : trois boutons suffisent, et les
 * réponses sont éphémères pour ne pas encombrer le salon.
 */
export function buildProfilePanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('📇 Ton profil')
    .setDescription(
      'Consulte ta progression sur le serveur.\n\n' +
      '> 👤 **Mon profil** — rangs, arrivée, activité\n' +
      '> 📊 **Mon XP** — niveau et progression\n' +
      '> 🏆 **Classement** — les membres les plus actifs\n\n' +
      'Les réponses ne sont visibles que par toi.',
    )
    .setFooter({ text: 'Gagne de l\'XP en discutant, en vocal et avec /recherche.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('profile:me')
      .setLabel('Mon profil')
      .setEmoji('👤')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('profile:xp')
      .setLabel('Mon XP')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('profile:top')
      .setLabel('Classement')
      .setEmoji('🏆')
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row] };
}

/** Routeur des boutons du panneau profil. */
export async function handleProfileButton(interaction, action) {
  const cfg = await getGuildConfig(interaction.guild.id);

  if (action === 'me') {
    const embed = await buildProfileEmbed(interaction.guild, interaction.member, cfg, {
      viewerId: interaction.user.id,
      canSeeWarns: true,
    });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === 'xp') {
    const embed = await buildXpEmbed(interaction.guild, interaction.member);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  if (action === 'top') {
    const embed = await buildLeaderboardEmbed(interaction.guild);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
