import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { sendLog } from '../../handlers/logs.js';
import { parseDuration, formatDuration } from '../../lib/time.js';

export const data = new SlashCommandBuilder()
  .setName('mod')
  .setDescription('Outils de modération')
  .addSubcommand((s) =>
    s.setName('warn')
      .setDescription('Avertir un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre à avertir').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Motif').setRequired(true).setMaxLength(500)))
  .addSubcommand((s) =>
    s.setName('warns')
      .setDescription('Voir les avertissements d\'un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('unwarn')
      .setDescription('Retirer un avertissement')
      .addIntegerOption((o) => o.setName('id').setDescription('ID de l\'avertissement').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('mute')
      .setDescription('Rendre un membre muet temporairement')
      .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption((o) => o.setName('durée').setDescription('ex : 10m, 2h, 1d (max 28j)').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Motif').setMaxLength(500)))
  .addSubcommand((s) =>
    s.setName('unmute')
      .setDescription('Rendre la parole à un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('kick')
      .setDescription('Expulser un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Motif').setMaxLength(500)))
  .addSubcommand((s) =>
    s.setName('ban')
      .setDescription('Bannir un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Membre').setRequired(true))
      .addStringOption((o) => o.setName('raison').setDescription('Motif').setMaxLength(500))
      .addIntegerOption((o) =>
        o.setName('purge_jours')
          .setDescription('Supprimer les messages des N derniers jours (0-7)')
          .setMinValue(0).setMaxValue(7)))
  .addSubcommand((s) =>
    s.setName('purge')
      .setDescription('Supprimer en masse les messages récents')
      .addIntegerOption((o) =>
        o.setName('nombre').setDescription('Nombre de messages (1-100)').setRequired(true)
          .setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que ses messages')))
  .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'warn':   return warn(interaction);
    case 'warns':  return listWarns(interaction);
    case 'unwarn': return unwarn(interaction);
    case 'mute':   return mute(interaction);
    case 'unmute': return unmute(interaction);
    case 'kick':   return kick(interaction);
    case 'ban':    return ban(interaction);
    case 'purge':  return purge(interaction);
  }
}

/**
 * Empêche une action de modération sur une cible non légitime.
 * Renvoie un message d'erreur, ou `null` si l'action est permise.
 */
function checkTarget(interaction, target) {
  if (target.id === interaction.user.id) return 'Tu ne peux pas te modérer toi-même.';
  if (target.id === interaction.client.user.id) return 'Je ne peux pas me modérer moi-même.';
  if (target.id === interaction.guild.ownerId) return 'Impossible de modérer le propriétaire du serveur.';

  const actor = interaction.member;
  // Le propriétaire est au-dessus de la hiérarchie des rôles.
  if (actor.id !== interaction.guild.ownerId &&
      target.roles.highest.position >= actor.roles.highest.position) {
    return 'Ce membre a un rôle supérieur ou égal au tien.';
  }

  const me = interaction.guild.members.me;
  if (target.roles.highest.position >= me.roles.highest.position) {
    return 'Ce membre a un rôle supérieur au mien — je ne peux pas agir sur lui.';
  }

  return null;
}

async function warn(interaction) {
  const user = interaction.options.getUser('membre');
  const reason = interaction.options.getString('raison');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (member) {
    const err = checkTarget(interaction, member);
    if (err) return interaction.reply({ content: `⛔ ${err}`, flags: MessageFlags.Ephemeral });
  }

  const { rows } = await query(
    `INSERT INTO warnings (guild_id, user_id, moderator_id, reason)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [interaction.guild.id, user.id, interaction.user.id, reason],
  );

  const { rows: count } = await query(
    'SELECT COUNT(*)::int AS n FROM warnings WHERE guild_id = $1 AND user_id = $2',
    [interaction.guild.id, user.id],
  );

  await user.send(
    `⚠️ Tu as reçu un avertissement sur **${interaction.guild.name}**.\n\n` +
    `**Motif :** ${reason}\n**Total :** ${count[0].n} avertissement(s)`,
  ).catch(() => {});

  await sendLog(interaction.guild, {
    color: COLORS.warning,
    title: '⚠️ Avertissement',
    description: `${user} (\`${user.tag}\`) a été averti par ${interaction.user}.`,
    fields: [
      { name: 'Motif', value: reason },
      { name: 'Total', value: `${count[0].n} avertissement(s)`, inline: true },
      { name: 'ID', value: `\`${rows[0].id}\``, inline: true },
    ],
  });

  return interaction.reply({
    content: `⚠️ ${user} averti (avertissement \`#${rows[0].id}\`, ${count[0].n} au total).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function listWarns(interaction) {
  const user = interaction.options.getUser('membre');

  const { rows } = await query(
    `SELECT id, moderator_id, reason, created_at FROM warnings
     WHERE guild_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 25`,
    [interaction.guild.id, user.id],
  );

  const embed = new EmbedBuilder()
    .setColor(rows.length > 0 ? COLORS.warning : COLORS.success)
    .setTitle(`⚠️ Avertissements — ${user.tag}`)
    .setDescription(
      rows.length === 0
        ? '✅ Aucun avertissement.'
        : rows.map((w) =>
            `**#${w.id}** — <t:${Math.floor(new Date(w.created_at).getTime() / 1000)}:R> par <@${w.moderator_id}>\n` +
            `> ${w.reason}`,
          ).join('\n\n'),
    )
    .setFooter({ text: `${rows.length} avertissement(s)` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function unwarn(interaction) {
  const id = interaction.options.getInteger('id');

  const { rowCount } = await query(
    'DELETE FROM warnings WHERE id = $1 AND guild_id = $2',
    [id, interaction.guild.id],
  );

  return interaction.reply({
    content: rowCount > 0
      ? `✅ Avertissement \`#${id}\` supprimé.`
      : `❌ Avertissement \`#${id}\` introuvable.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function mute(interaction) {
  const user = interaction.options.getUser('membre');
  const durationRaw = interaction.options.getString('durée');
  const reason = interaction.options.getString('raison') ?? 'Aucun motif fourni';

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
  }

  const err = checkTarget(interaction, member);
  if (err) return interaction.reply({ content: `⛔ ${err}`, flags: MessageFlags.Ephemeral });

  const ms = parseDuration(durationRaw);
  if (ms === null) {
    return interaction.reply({
      content: '❌ Durée invalide. Utilise par exemple `10m`, `2h`, `1d`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Discord plafonne le timeout à 28 jours.
  const MAX = 28 * 24 * 60 * 60 * 1000;
  if (ms > MAX) {
    return interaction.reply({
      content: '❌ La durée maximale d\'un mute est de 28 jours.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await member.timeout(ms, `${reason} — par ${interaction.user.tag}`);

  await user.send(
    `🔇 Tu as été rendu muet sur **${interaction.guild.name}** pour **${formatDuration(ms)}**.\n\n**Motif :** ${reason}`,
  ).catch(() => {});

  await sendLog(interaction.guild, {
    color: COLORS.warning,
    title: '🔇 Membre rendu muet',
    description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
    fields: [
      { name: 'Durée', value: formatDuration(ms), inline: true },
      { name: 'Motif', value: reason },
    ],
  });

  return interaction.reply({
    content: `🔇 ${user} est muet pour **${formatDuration(ms)}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function unmute(interaction) {
  const user = interaction.options.getUser('membre');
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);

  if (!member) {
    return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
  }

  await member.timeout(null, `Levé par ${interaction.user.tag}`);

  await sendLog(interaction.guild, {
    color: COLORS.success,
    title: '🔊 Mute levé',
    description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
  });

  return interaction.reply({
    content: `🔊 ${user} peut de nouveau parler.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function kick(interaction) {
  const user = interaction.options.getUser('membre');
  const reason = interaction.options.getString('raison') ?? 'Aucun motif fourni';

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return interaction.reply({ content: '❌ Membre introuvable.', flags: MessageFlags.Ephemeral });
  }

  const err = checkTarget(interaction, member);
  if (err) return interaction.reply({ content: `⛔ ${err}`, flags: MessageFlags.Ephemeral });

  // Le MP doit partir avant l'expulsion : après, le bot n'a plus de canal commun.
  await user.send(
    `👋 Tu as été expulsé de **${interaction.guild.name}**.\n\n**Motif :** ${reason}`,
  ).catch(() => {});

  await member.kick(`${reason} — par ${interaction.user.tag}`);

  await sendLog(interaction.guild, {
    color: COLORS.danger,
    title: '👢 Membre expulsé',
    description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
    fields: [{ name: 'Motif', value: reason }],
  });

  return interaction.reply({
    content: `👢 ${user.tag} a été expulsé.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function ban(interaction) {
  const user = interaction.options.getUser('membre');
  const reason = interaction.options.getString('raison') ?? 'Aucun motif fourni';
  const purgeDays = interaction.options.getInteger('purge_jours') ?? 0;

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member) {
    const err = checkTarget(interaction, member);
    if (err) return interaction.reply({ content: `⛔ ${err}`, flags: MessageFlags.Ephemeral });

    await user.send(
      `🔨 Tu as été banni de **${interaction.guild.name}**.\n\n**Motif :** ${reason}`,
    ).catch(() => {});
  }

  await interaction.guild.members.ban(user.id, {
    reason: `${reason} — par ${interaction.user.tag}`,
    deleteMessageSeconds: purgeDays * 86_400,
  });

  await sendLog(interaction.guild, {
    color: COLORS.danger,
    title: '🔨 Membre banni',
    description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
    fields: [
      { name: 'Motif', value: reason },
      ...(purgeDays > 0
        ? [{ name: 'Messages supprimés', value: `${purgeDays} jour(s)`, inline: true }]
        : []),
    ],
  });

  return interaction.reply({
    content: `🔨 ${user.tag} a été banni.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function purge(interaction) {
  const amount = interaction.options.getInteger('nombre');
  const target = interaction.options.getUser('membre');

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const messages = await interaction.channel.messages.fetch({ limit: 100 });

  // bulkDelete refuse les messages de plus de 14 jours : on filtre en amont
  // pour éviter un rejet global du lot.
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const deletable = [...messages.values()]
    .filter((m) => m.createdTimestamp > cutoff)
    .filter((m) => !target || m.author.id === target.id)
    .slice(0, amount);

  if (deletable.length === 0) {
    return interaction.editReply(
      '❌ Aucun message à supprimer (les messages de plus de 14 jours ne peuvent pas être supprimés en masse).',
    );
  }

  const deleted = await interaction.channel.bulkDelete(deletable, true);

  await sendLog(interaction.guild, {
    color: COLORS.info,
    title: '🧹 Purge de messages',
    description:
      `**${deleted.size}** message(s) supprimé(s) dans ${interaction.channel} par ${interaction.user}` +
      (target ? `\n**Filtré sur :** ${target}` : ''),
  });

  return interaction.editReply(`🧹 **${deleted.size}** message(s) supprimé(s).`);
}
