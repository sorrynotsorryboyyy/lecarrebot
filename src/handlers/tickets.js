import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig, query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { log } from '../lib/logger.js';
import { sendLog } from './logs.js';

/**
 * Tickets de support.
 *
 * Un bouton dans #🎫-support ouvre un salon privé entre le membre et le
 * staff. À la fermeture, la conversation est transcrite dans le journal
 * puis le salon est supprimé — sans quoi la catégorie s'encombrerait de
 * salons morts.
 *
 * Un seul ticket ouvert par membre : la garde s'appuie sur un index
 * partiel, ce qui la rend immédiate même sur un serveur actif.
 */

/** Nombre de messages repris dans la transcription. */
const TRANSCRIPT_LIMIT = 100;

/** Délai avant suppression du salon, pour laisser lire la confirmation. */
const CLOSE_DELAY_MS = 10_000;

/** Panneau permanent publié dans #🎫-support par /setup. */
export function buildTicketPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎫 Besoin d\'aide ?')
    .setDescription(
      'Ouvre un **ticket privé** avec le staff. Personne d\'autre ne verra ' +
      'la conversation.\n\n' +
      '**Dans quels cas ?**\n' +
      '> • Signaler un membre ou un comportement\n' +
      '> • Contester une sanction\n' +
      '> • Une question sur le serveur\n' +
      '> • Un problème technique avec le bot\n\n' +
      'Un salon est créé rien que pour toi. Il se ferme quand ta demande ' +
      'est réglée.',
    )
    .setFooter({ text: 'Un seul ticket à la fois — merci de ne pas en abuser.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:open:new')
      .setLabel('Ouvrir un ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Clic sur « Ouvrir un ticket » : on demande d'abord le motif.
 * `showModal()` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openTicketModal(interaction) {
  const existing = await query(
    'SELECT channel_id FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status = $3',
    [interaction.guild.id, interaction.user.id, 'open'],
  );

  if (existing.rows.length > 0) {
    return interaction.reply({
      content:
        `⚠️ Tu as déjà un ticket ouvert : <#${existing.rows[0].channel_id}>\n\n` +
        'Ferme-le avant d\'en ouvrir un nouveau.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder()
    .setCustomId('ticket:submit:new')
    .setTitle('Nouveau ticket');

  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('subject')
      .setLabel('Explique ta demande en quelques mots')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(500)
      .setPlaceholder('Décris ton problème ou ta question…'),
  ));

  return interaction.showModal(modal);
}

/** Création effective du salon de ticket. */
export async function createTicket(interaction) {
  const subject = interaction.fields.getTextInputValue('subject').trim();
  const guild = interaction.guild;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const cfg = await getGuildConfig(guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const parentId = channelIds['cat:tickets'] ?? null;

  // Deuxième contrôle : entre l'ouverture du formulaire et sa soumission,
  // le membre a pu créer un ticket par un autre chemin.
  const existing = await query(
    'SELECT channel_id FROM tickets WHERE guild_id = $1 AND user_id = $2 AND status = $3',
    [guild.id, interaction.user.id, 'open'],
  );

  if (existing.rows.length > 0) {
    return interaction.editReply(
      `⚠️ Tu as déjà un ticket ouvert : <#${existing.rows[0].channel_id}>`,
    );
  }

  try {
    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
        ],
      },
    ];

    // Le staff est identifié par ses rôles réels : ceux qui portent la
    // permission de modération. Un rôle staff créé à la main y a donc
    // accès sans réglage supplémentaire.
    for (const role of guild.roles.cache.values()) {
      if (role.managed || role.id === guild.roles.everyone.id) continue;
      if (!role.permissions.has(PermissionFlagsBits.ModerateMembers)) continue;

      overwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      });
    }

    const channel = await guild.channels.create({
      name: `ticket-${interaction.user.username}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent: parentId,
      topic: `Ticket de ${interaction.user.tag}`,
      permissionOverwrites: overwrites,
      reason: `Ticket ouvert par ${interaction.user.tag}`,
    });

    const { rows } = await query(
      `INSERT INTO tickets (guild_id, channel_id, user_id, subject)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [guild.id, channel.id, interaction.user.id, subject],
    );
    const ticketId = rows[0].id;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle(`🎫 Ticket #${ticketId}`)
      .setDescription(
        `${interaction.user} a ouvert un ticket.\n\n` +
        `**Demande :**\n>>> ${subject}`,
      )
      .setFooter({ text: 'Le staff te répondra ici. Ferme le ticket quand c\'est réglé.' })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`ticket:close:${ticketId}`)
        .setLabel('Fermer le ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({ content: `${interaction.user}`, embeds: [embed], components: [row] });

    await sendLog(guild, {
      color: COLORS.primary,
      title: '🎫 Ticket ouvert',
      description: `${interaction.user} a ouvert le ticket **#${ticketId}** dans ${channel}.`,
      fields: [{ name: 'Demande', value: subject.slice(0, 1024) }],
    });

    return interaction.editReply(`✅ Ton ticket est ouvert : ${channel}`);
  } catch (err) {
    log.warn(`Création de ticket impossible : ${err.message}`);
    return interaction.editReply(
      `❌ Impossible d'ouvrir le ticket : ${err.message}\n` +
      'Préviens un administrateur.',
    );
  }
}

/**
 * Fermeture d'un ticket : transcription, journal, suppression du salon.
 *
 * Accessible à l'auteur du ticket et au staff. Un membre extérieur ne voit
 * de toute façon pas le salon.
 */
export async function closeTicket(interaction, ticketId) {
  const { rows } = await query(
    'SELECT * FROM tickets WHERE id = $1',
    [ticketId],
  );
  const ticket = rows[0];

  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({
      content: '⚠️ Ce ticket est déjà fermé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const isOwner = ticket.user_id === interaction.user.id;
  const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers);

  if (!isOwner && !isStaff) {
    return interaction.reply({
      content: '⛔ Seuls l\'auteur du ticket et le staff peuvent le fermer.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '🔒 Ticket fermé. Le salon sera supprimé dans quelques secondes…',
  });

  await query(
    'UPDATE tickets SET status = $2, closed_by = $3, closed_at = NOW() WHERE id = $1',
    [ticketId, 'closed', interaction.user.id],
  );

  const transcript = await buildTranscript(interaction.channel);

  await sendLog(interaction.guild, {
    color: COLORS.info,
    title: `🎫 Ticket #${ticketId} fermé`,
    description:
      `Ouvert par <@${ticket.user_id}>, fermé par ${interaction.user}.\n\n` +
      `**Demande initiale :**\n>>> ${(ticket.subject ?? '—').slice(0, 900)}`,
    files: transcript ? [transcript] : [],
  });

  setTimeout(() => {
    interaction.channel.delete('Ticket fermé').catch(() => {});
  }, CLOSE_DELAY_MS);
}

/**
 * Transcrit un salon en fichier texte.
 *
 * Un fichier joint plutôt qu'un embed : une conversation entière n'y
 * tiendrait pas. Le tampon reste en mémoire — le disque de Railway est
 * éphémère, y écrire n'aurait aucun sens.
 */
async function buildTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({ limit: TRANSCRIPT_LIMIT });

    // `fetch` renvoie du plus récent au plus ancien : on inverse pour
    // relire la conversation dans l'ordre.
    const lines = [...messages.values()]
      .reverse()
      .map((m) => {
        const time = new Date(m.createdTimestamp).toISOString();
        const parts = [`[${time}] ${m.author.tag} : ${m.content || '(sans texte)'}`];

        for (const a of m.attachments.values()) parts.push(`    📎 ${a.name} — ${a.url}`);
        for (const e of m.embeds) if (e.title) parts.push(`    📋 ${e.title}`);

        return parts.join('\n');
      });

    if (lines.length === 0) return null;

    const header = [
      `Transcription du salon #${channel.name}`,
      `Générée le ${new Date().toISOString()}`,
      messages.size >= TRANSCRIPT_LIMIT
        ? `⚠️ Limité aux ${TRANSCRIPT_LIMIT} derniers messages.`
        : `${lines.length} message(s).`,
      '─'.repeat(60),
      '',
    ].join('\n');

    return new AttachmentBuilder(Buffer.from(header + lines.join('\n'), 'utf8'), {
      name: `transcription-${channel.name}.txt`,
    });
  } catch (err) {
    log.debug(`Transcription impossible : ${err.message}`);
    return null;
  }
}

/**
 * Referme les tickets dont le salon a disparu.
 *
 * Un salon supprimé à la main laisserait son ticket « ouvert » en base, et
 * son auteur ne pourrait plus jamais en créer un autre. Même principe que
 * la réconciliation des vocaux temporaires.
 */
export async function reconcileTickets(client) {
  const { rows } = await query('SELECT * FROM tickets WHERE status = $1', ['open']);

  let closed = 0;

  for (const ticket of rows) {
    const channel = await client.channels.fetch(ticket.channel_id).catch(() => null);
    if (channel) continue;

    await query(
      'UPDATE tickets SET status = $2, closed_at = NOW() WHERE id = $1',
      [ticket.id, 'closed'],
    );
    closed++;
  }

  if (closed > 0) log.info(`${closed} ticket(s) orphelin(s) refermé(s)`);
}
