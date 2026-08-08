import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { getGuildConfig, query } from '../../db/index.js';
import { buildLfgMessage } from '../../lib/embeds.js';
import { lfgRankChoices } from '../../lib/ranks.js';

/** Modes de jeu CS2 proposés à l'autocomplétion. */
const MODES = [
  { name: 'Compétitif (5v5)', value: 'Compétitif 5v5' },
  { name: 'Premier',          value: 'Premier' },
  { name: 'Faceit',           value: 'Faceit' },
  { name: 'Wingman (2v2)',    value: 'Wingman 2v2' },
  { name: 'Deathmatch',       value: 'Deathmatch' },
  { name: 'Retake / Aim',     value: 'Retake / Aim' },
  { name: 'Détente / Casual', value: 'Casual' },
];

// Les rangs viennent de src/lib/ranks.js : une seule source de vérité,
// partagée avec /setup, les menus, /profil et /stats. Les anciens rangs
// CSGO (Silver, Nova, Global) n'existent plus depuis CS2 en 2023.
const RANK_CHOICES = lfgRankChoices();

export const data = new SlashCommandBuilder()
  .setName('lfg')
  .setDescription('Cherche des mates pour jouer')
  .addStringOption((o) =>
    o.setName('mode')
      .setDescription('Mode de jeu recherché')
      .setRequired(true)
      .addChoices(...MODES.map((m) => ({ name: m.name, value: m.value }))))
  .addIntegerOption((o) =>
    o.setName('places')
      .setDescription('Nombre de joueurs recherchés')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(9))
  .addStringOption((o) =>
    o.setName('rang')
      .setDescription('Ton rang / le rang recherché')
      .addChoices(...RANK_CHOICES))
  .addStringOption((o) =>
    o.setName('note')
      .setDescription('Précision libre (micro obligatoire, chill, tryhard…)')
      .setMaxLength(200));

export async function execute(interaction) {
  const mode = interaction.options.getString('mode');
  const slots = interaction.options.getInteger('places');
  const rank = interaction.options.getString('rang');
  const note = interaction.options.getString('note');

  const cfg = await getGuildConfig(interaction.guild.id);

  // Poste dans le salon LFG dédié s'il est configuré, sinon sur place.
  const targetId = cfg.lfg_channel_id ?? interaction.channel.id;
  const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);

  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: '⚠️ Le salon LFG configuré est introuvable. Préviens un administrateur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const { rows } = await query(
    `INSERT INTO lfg_posts (guild_id, channel_id, user_id, mode, rank, slots, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [interaction.guild.id, channel.id, interaction.user.id, mode, rank, slots, note],
  );
  const postId = rows[0].id;

  const message = await channel.send(
    buildLfgMessage({
      id: postId,
      author: interaction.user,
      mode, rank, slots, note,
      joined: [],
      closed: false,
    }),
  );

  await query('UPDATE lfg_posts SET message_id = $2 WHERE id = $1', [postId, message.id]);

  const sameChannel = channel.id === interaction.channel.id;
  return interaction.reply({
    content: sameChannel
      ? '✅ Ton annonce est publiée !'
      : `✅ Ton annonce est publiée dans ${channel} !`,
    flags: MessageFlags.Ephemeral,
  });
}
