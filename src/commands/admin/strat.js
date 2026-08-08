import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig, query } from '../../db/index.js';
import { parseJsonColumn } from '../../lib/jsonColumn.js';
import { log } from '../../lib/logger.js';

/**
 * Cartes du pool actif CS2, avec leur couleur dominante — l'embed reprend
 * l'ambiance de la carte, ce qui rend le salon lisible d'un coup d'œil.
 */
export const MAPS = [
  { name: 'Mirage',    value: 'Mirage',    color: 0xd4a24c, emoji: '🏜️' },
  { name: 'Inferno',   value: 'Inferno',   color: 0xc0392b, emoji: '🔥' },
  { name: 'Nuke',      value: 'Nuke',      color: 0x95a5a6, emoji: '☢️' },
  { name: 'Overpass',  value: 'Overpass',  color: 0x27ae60, emoji: '🌉' },
  { name: 'Ancient',   value: 'Ancient',   color: 0x16a085, emoji: '🗿' },
  { name: 'Anubis',    value: 'Anubis',    color: 0xe67e22, emoji: '🐫' },
  { name: 'Dust II',   value: 'Dust II',   color: 0xc8a165, emoji: '🏛️' },
  { name: 'Train',     value: 'Train',     color: 0x7f8c8d, emoji: '🚂' },
  { name: 'Vertigo',   value: 'Vertigo',   color: 0x34495e, emoji: '🏗️' },
];

const SIDES = [
  { name: 'Terroristes (T)', value: 'T' },
  { name: 'Anti-terroristes (CT)', value: 'CT' },
  { name: 'Les deux côtés', value: 'Both' },
];

export const data = new SlashCommandBuilder()
  .setName('strat')
  .setDescription('Publier une stratégie ou un line-up')
  .addStringOption((o) =>
    o.setName('carte')
      .setDescription('La carte concernée')
      .setRequired(true)
      .addChoices(...MAPS.map((m) => ({ name: `${m.emoji} ${m.name}`, value: m.value }))))
  .addStringOption((o) =>
    o.setName('côté')
      .setDescription('Le côté concerné')
      .setRequired(true)
      .addChoices(...SIDES))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);

export async function execute(interaction) {
  const map = interaction.options.getString('carte');
  const side = interaction.options.getString('côté');

  // Le formulaire recueille les textes longs : les options de commande ne
  // permettent ni saut de ligne ni confort de saisie.
  const modal = new ModalBuilder()
    .setCustomId(`strat:submit:${map}|${side}`)
    .setTitle(`Strat — ${map}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Titre de la strat')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200)
        .setPlaceholder('Rush B avec smoke CT'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Déroulé / explications')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(3000)
        .setPlaceholder('1. Le joueur A lance sa smoke depuis…'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('link')
        .setLabel('Lien vidéo ou image (facultatif)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder('https://youtube.com/…'),
    ),
  );

  return interaction.showModal(modal);
}

/** Réception du formulaire : construit l'embed et le publie. */
export async function receiveStrat(interaction, arg) {
  const [map, side] = String(arg).split('|');
  const spec = MAPS.find((m) => m.value === map);

  const title = interaction.fields.getTextInputValue('title').trim();
  const description = interaction.fields.getTextInputValue('description').trim();
  const link = interaction.fields.getTextInputValue('link')?.trim() ?? '';

  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const channelId = channelIds.strats;

  if (!channelId) {
    return interaction.reply({
      content: '⚠️ Le salon des strats est introuvable. Relance `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const sideLabel = side === 'Both' ? 'T & CT' : side;

  const embed = new EmbedBuilder()
    .setColor(spec?.color ?? 0x5865f2)
    .setTitle(`${spec?.emoji ?? '🗺️'} ${title}`)
    .setDescription(description)
    .addFields(
      { name: 'Carte', value: map, inline: true },
      { name: 'Côté', value: sideLabel, inline: true },
    )
    .setFooter({ text: `Publié par ${interaction.user.tag}` })
    .setTimestamp();

  if (link && /^https?:\/\/\S+$/i.test(link)) {
    // Une image s'affiche ; une vidéo reste un lien cliquable.
    if (/\.(png|jpe?g|gif|webp)$/i.test(link)) embed.setImage(link);
    else embed.addFields({ name: 'Ressource', value: link });
  }

  try {
    const channel = await interaction.guild.channels.fetch(channelId);
    const message = await channel.send({ embeds: [embed] });

    await query(
      `INSERT INTO strats (guild_id, message_id, map, side, title, description, link, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [interaction.guild.id, message.id, map, side, title, description, link || null, interaction.user.id],
    );

    return interaction.reply({
      content: `✅ Strat publiée dans ${channel} !`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.warn(`Publication de strat impossible : ${err.message}`);
    return interaction.reply({
      content: `❌ Publication impossible : ${err.message}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}
