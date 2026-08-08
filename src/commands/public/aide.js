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
          `**1.** Choisis ton rang CS2 dans ${ref('roles', '#🎭-roles')}\n` +
          `**2.** Présente-toi et trouve des mates\n` +
          `**3.** Utilise les commandes dans ${ref('commands', '#🤖-commandes')}`,
      },
      {
        name: '🎯 Jouer ensemble',
        value:
          '`/recherche` — Publie une annonce pour trouver des coéquipiers\n' +
          '> Choisis le mode, ton rang et le nombre de places.\n' +
          '> Les intéressés cliquent sur **Rejoindre**, tu reçois un MP.',
      },
      {
        name: '📊 Ta progression',
        value:
          '`/profil` — Ta fiche : rangs, arrivée, activité\n' +
          '`/xp` — Ton niveau et ta progression\n' +
          '`/classement` — Les membres les plus actifs\n' +
          '`/stats` — Répartition des rangs du serveur\n\n' +
          '> Tu gagnes de l\'XP en discutant, en vocal et via `/recherche`.',
      },
      {
        name: '🔊 Salons vocaux',
        value:
          'Rejoins **➕ Créer un salon** pour obtenir ton propre vocal.\n' +
          `> Tu peux le renommer, limiter les places, le rendre privé…\n` +
          `> Les boutons de gestion sont dans ${ref('commands', '#🤖-commandes')}.`,
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
