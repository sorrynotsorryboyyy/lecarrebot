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
          '> Les boutons de gestion apparaissent dans le chat du salon créé.',
      },
      {
        name: '👤 Ton profil',
        value:
          '`/profil` — tes rangs, ton arrivée, tes invitations et ton activité\n' +
          '`/lier faceit` — affiche ton niveau et ton Elo sur ton profil\n' +
          '`/lier steam` — affiche tes heures de jeu et tes stats CS2\n' +
          '`/aide` — ce guide, à tout moment',
      },
      {
        name: '🏅 Les statuts',
        value:
          '> 💎 **Elite** — avantages sur les giveaways, les vocaux et un salon dédié\n' +
          '> 🔷 **Losange Vérifié** — espace privé, attribué à la main par le staff',
      },
      {
        name: '📌 À savoir',
        value:
          `> 💬 Dans ${ref('general', '#💬-general')} : GIF autorisés, images et liens non\n` +
          `> 🎬 Dans ${ref('clips', '#🎬-clips-et-memes')} : tout est permis\n` +
          `> 🏆 Tournois et giveaways dans ${ref('tournaments', '#🏆-tournois')}\n` +
          `> 🎫 Un souci ? Ouvre un ticket dans ${ref('support', '#🎫-support')}`,
      },
    )
    .setFooter({ text: 'Une question ? Le staff est là pour t\'aider.' });
}
