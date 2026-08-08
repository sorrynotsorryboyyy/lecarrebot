import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig, query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { buildLfgMessage } from '../lib/embeds.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { log } from '../lib/logger.js';

/**
 * Recherche de mates au clic.
 *
 * Remplace la commande /recherche : un bouton par mode, puis un formulaire
 * court. Plus rien à taper, et les options impossibles à se tromper.
 */

/** Modes proposés — un bouton chacun (limite Discord : 5 par rangée). */
export const LFG_MODES = {
  premier: { id: 'premier', label: 'Premier', emoji: '🏆', name: 'Premier', style: ButtonStyle.Success },
  comp:    { id: 'comp',    label: 'Compétitif', emoji: '🎯', name: 'Compétitif 5v5', style: ButtonStyle.Primary },
  faceit:  { id: 'faceit',  label: 'Faceit', emoji: '⚡', name: 'Faceit', style: ButtonStyle.Danger },
  wingman: { id: 'wingman', label: 'Wingman', emoji: '👥', name: 'Wingman 2v2', style: ButtonStyle.Secondary },
  chill:   { id: 'chill',   label: 'Chill', emoji: '😎', name: 'Casual / Détente', style: ButtonStyle.Secondary },
};

/** Taille d'équipe par défaut, pré-remplie dans le formulaire. */
const DEFAULT_TEAM = { premier: 5, comp: 5, faceit: 5, wingman: 2, chill: 5 };

/** Panneau permanent publié dans #🎮-recherche-mates. */
export function buildLfgPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 Trouver des mates')
    .setDescription(
      'Clique sur le mode auquel tu veux jouer. Un petit formulaire ' +
      's\'ouvre, et ton annonce est publiée aussitôt.\n\n' +
      '> 🏆 **Premier** — matchmaking classé\n' +
      '> 🎯 **Compétitif** — 5v5 classique\n' +
      '> ⚡ **Faceit** — parties Faceit\n' +
      '> 👥 **Wingman** — 2v2\n' +
      '> 😎 **Chill** — détente, sans pression\n\n' +
      'Les intéressés cliquent sur **Rejoindre** — tu reçois un message privé.',
    )
    .setFooter({ text: 'La taille de l\'équipe te compte : 5 = équipe de 5 au total.' });

  const row = new ActionRowBuilder().addComponents(
    Object.values(LFG_MODES).map((mode) =>
      new ButtonBuilder()
        .setCustomId(`lfgpanel:mode:${mode.id}`)
        .setLabel(mode.label)
        .setEmoji(mode.emoji)
        .setStyle(mode.style)),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Ouvre le formulaire du mode choisi.
 * `showModal()` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openLfgComposer(interaction, modeId) {
  const mode = LFG_MODES[modeId];
  if (!mode) return;

  const modal = new ModalBuilder()
    .setCustomId(`lfgpanel:submit:${modeId}`)
    .setTitle(`Recherche — ${mode.label}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team')
        .setLabel('Taille de l\'équipe (toi compris)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue(String(DEFAULT_TEAM[modeId] ?? 5)),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rank')
        .setLabel('Rang recherché (facultatif)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder('10k-13k, Faceit 7-8, peu importe…'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Précisions (facultatif)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
        .setPlaceholder('Micro obligatoire, tryhard, une seule partie…'),
    ),
  );

  return interaction.showModal(modal);
}

/** Réception du formulaire : publication de l'annonce. */
export async function publishLfg(interaction, modeId) {
  const mode = LFG_MODES[modeId];
  if (!mode) return;

  const rawTeam = interaction.fields.getTextInputValue('team').trim();
  const rank = interaction.fields.getTextInputValue('rank')?.trim() || null;
  const note = interaction.fields.getTextInputValue('note')?.trim() || null;

  const slots = Number.parseInt(rawTeam, 10);

  // `slots` compte l'équipe entière : en dessous de 2, personne à chercher.
  if (Number.isNaN(slots) || slots < 2 || slots > 10) {
    return interaction.reply({
      content: '❌ La taille de l\'équipe doit être un nombre entre **2** et **10** (toi compris).',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = channelIds.lfg ?? cfg.lfg_channel_id ?? interaction.channel.id;

  const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);

  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: '⚠️ Le salon de recherche est introuvable. Préviens un administrateur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    const { rows } = await query(
      `INSERT INTO lfg_posts (guild_id, channel_id, user_id, mode, rank, slots, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [interaction.guild.id, channel.id, interaction.user.id, mode.name, rank, slots, note],
    );
    const postId = rows[0].id;

    const message = await channel.send(
      buildLfgMessage({
        id: postId,
        author: interaction.user,
        mode: mode.name,
        rank, slots, note,
        joined: [],
        closed: false,
      }),
    );

    await query('UPDATE lfg_posts SET message_id = $2 WHERE id = $1', [postId, message.id]);

    return interaction.reply({
      content: `✅ Ton annonce **${mode.label}** est publiée dans ${channel} !`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.warn(`Publication d'annonce impossible : ${err.message}`);
    return interaction.reply({
      content: `❌ Publication impossible : ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
