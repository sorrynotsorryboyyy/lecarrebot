import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { query } from '../../db/index.js';
import { parseDuration } from '../../lib/time.js';
import { buildGiveawayMessage } from '../../lib/embeds.js';
import { endGiveaway } from '../../handlers/giveaway.js';

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Gestion des giveaways')
  .addSubcommand((s) =>
    s.setName('lancer')
      .setDescription('Lancer un giveaway')
      .addStringOption((o) =>
        o.setName('lot').setDescription('Ce qui est à gagner').setRequired(true).setMaxLength(200))
      .addStringOption((o) =>
        o.setName('durée')
          .setDescription('Durée du giveaway (ex : 24h, 3d, 30m)')
          .setRequired(true))
      .addIntegerOption((o) =>
        o.setName('gagnants')
          .setDescription('Nombre de gagnants (défaut : 1)')
          .setMinValue(1).setMaxValue(20))
      .addBooleanOption((o) =>
        o.setName('vip_uniquement')
          .setDescription('Réserver ce giveaway aux membres Elite (VIP)'))
      .addStringOption((o) =>
        o.setName('conditions')
          .setDescription('Conditions affichées (ex : inviter 10 personnes). Sépare par « | »')
          .setMaxLength(500)))
  .addSubcommand((s) =>
    s.setName('terminer')
      .setDescription('Terminer un giveaway immédiatement')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du giveaway').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('relancer')
      .setDescription('Retirer au sort de nouveaux gagnants')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du giveaway').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'lancer') return startGiveaway(interaction);
  if (sub === 'terminer') return finishNow(interaction);
  if (sub === 'relancer') return reroll(interaction);
}

async function startGiveaway(interaction) {
  const prize = interaction.options.getString('lot');
  const durationRaw = interaction.options.getString('durée');
  const winners = interaction.options.getInteger('gagnants') ?? 1;

  const ms = parseDuration(durationRaw);
  if (ms === null) {
    return interaction.reply({
      content: '❌ Durée invalide. Utilise par exemple `30m`, `24h`, `3d` ou `1d12h`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const endsAt = new Date(Date.now() + ms);

  const vipOnly = interaction.options.getBoolean('vip_uniquement') ?? false;
  const conditions = interaction.options.getString('conditions')?.trim() || null;

  const { rows } = await query(
    `INSERT INTO giveaways
       (guild_id, channel_id, prize, winners, ends_at, created_by, vip_only, conditions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      interaction.guild.id, interaction.channel.id, prize, winners, endsAt,
      interaction.user.id, vipOnly, conditions,
    ],
  );
  const id = rows[0].id;

  const message = await interaction.channel.send(
    buildGiveawayMessage({
      id, prize, winners, endsAt, entries: 0, ended: false, vipOnly, conditions,
    }),
  );

  await query('UPDATE giveaways SET message_id = $2 WHERE id = $1', [id, message.id]);

  return interaction.reply({
    content: `🎁 Giveaway lancé (ID \`${id}\`) — fin <t:${Math.floor(endsAt.getTime() / 1000)}:R>.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function finishNow(interaction) {
  const id = interaction.options.getInteger('id');

  const { rows } = await query(
    'SELECT * FROM giveaways WHERE id = $1 AND guild_id = $2 AND ended = FALSE',
    [id, interaction.guild.id],
  );
  if (rows.length === 0) {
    return interaction.reply({
      content: '❌ Giveaway introuvable ou déjà terminé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: `⏱️ Giveaway \`#${id}\` terminé manuellement.`,
    flags: MessageFlags.Ephemeral,
  });

  await endGiveaway(interaction.client, rows[0]);
}

async function reroll(interaction) {
  const id = interaction.options.getInteger('id');

  const { rows } = await query(
    'SELECT * FROM giveaways WHERE id = $1 AND guild_id = $2 AND ended = TRUE',
    [id, interaction.guild.id],
  );
  if (rows.length === 0) {
    return interaction.reply({
      content: '❌ Giveaway introuvable ou pas encore terminé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: `🎲 Nouveau tirage lancé pour le giveaway \`#${id}\`.`,
    flags: MessageFlags.Ephemeral,
  });

  await endGiveaway(interaction.client, rows[0], { reroll: true });
}
