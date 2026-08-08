import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { parseJsonColumn } from '../../lib/jsonColumn.js';

export const data = new SlashCommandBuilder()
  .setName('aide')
  .setDescription('Guide du serveur et des commandes');

export async function execute(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);
  const embed = buildHelpEmbed(interaction.guild, cfg);

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Guide des membres, publié aussi en permanence dans #👋-bienvenue.
 *
 * Volontairement limité aux commandes des membres : les outils du staff
 * n'ont rien à faire dans un guide destiné à tout le serveur.
 */
export function buildHelpEmbed(guild, cfg) {
  const channels = parseJsonColumn(cfg?.channel_ids);
  const ref = (key, fallback) => (channels[key] ? `<#${channels[key]}>` : `**${fallback}**`);

  return new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎮 Bienvenue sur le serveur !')
    .setDescription(
      'Voici tout ce qu\'il faut savoir pour bien démarrer.',
    )
    .setThumbnail(guild.iconURL({ size: 256 }))
    .addFields(
      {
        name: '🚀 Pour commencer',
        value:
          `**1.** Choisis ton rang CS2 et tes rôles dans ${ref('roles', '#🎭-roles')}\n` +
          `**2.** Trouve des mates dans ${ref('lfg', '#🎮-recherche-mates')}\n` +
          '**3.** Viens discuter et partager tes clips !',
      },
      {
        name: '🎯 Jouer ensemble',
        value:
          `Dans ${ref('lfg', '#🎮-recherche-mates')}, clique simplement sur le mode ` +
          'auquel tu veux jouer.\n' +
          '> Un petit formulaire s\'ouvre, ton annonce est publiée.\n' +
          '> Les intéressés cliquent sur **Rejoindre** — tu reçois un message privé.',
      },
      {
        name: '🔊 Salons vocaux',
        value:
          'Rejoins **➕ Créer un salon** pour obtenir ton propre vocal.\n' +
          '> Renomme-le, limite les places, rends-le privé, invite qui tu veux.\n' +
          `> Les boutons de gestion sont dans ${ref('lfg', '#🎮-recherche-mates')}.`,
      },
      {
        name: '👤 Ton profil',
        value: '`/profil` — tes rangs, ton arrivée et ton activité sur le serveur',
      },
      {
        name: '📌 À savoir',
        value:
          `> 💬 Dans ${ref('general', '#💬-general')} : GIF autorisés, images et liens non\n` +
          `> 😂 Dans ${ref('memes', '#😂-memes')} : tout est permis\n` +
          `> 🎬 Dans ${ref('clips', '#🎬-clips')} : vidéos et liens uniquement\n` +
          `> 🏆 Tournois et giveaways dans ${ref('tournaments', '#🏆-tournois')}`,
      },
    )
    .setFooter({ text: 'Une question ? Le staff est là pour t\'aider.' });
}
