import {
  ActionRowBuilder,
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
import { log } from '../lib/logger.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';

/**
 * Salons vocaux créés à la demande.
 *
 * Rejoindre le salon « générateur » crée un vocal personnel dont le membre
 * est propriétaire, et l'y déplace. Le salon disparaît dès qu'il se vide.
 *
 * L'état vit en base plutôt qu'en mémoire : un redémarrage ne doit pas
 * laisser des salons orphelins que plus personne ne peut gérer.
 */

/** Crée un salon personnel et y déplace le membre. */
export async function createTempChannel(member, hubChannel) {
  const guild = member.guild;

  const channel = await guild.channels.create({
    name: `🔊 ${member.displayName}`,
    type: ChannelType.GuildVoice,
    parent: hubChannel.parentId,
    // Hérite des permissions de la catégorie : les membres voient et
    // rejoignent, le propriétaire gère le sien.
    permissionOverwrites: [
      ...hubChannel.parent?.permissionOverwrites.cache.map((o) => ({
        id: o.id,
        allow: o.allow.toArray(),
        deny: o.deny.toArray(),
      })) ?? [],
      {
        id: member.id,
        allow: [
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.ViewChannel,
        ],
      },
    ],
    reason: `Salon personnel de ${member.user.tag}`,
  });

  await query(
    `INSERT INTO temp_voice_channels (channel_id, guild_id, owner_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (channel_id) DO UPDATE SET owner_id = EXCLUDED.owner_id`,
    [channel.id, guild.id, member.id],
  );

  let moved = true;
  await member.voice.setChannel(channel).catch(() => {
    // Le membre a quitté avant le déplacement : on nettoie.
    moved = false;
    channel.delete('Propriétaire parti avant le déplacement').catch(() => {});
  });

  if (!moved) return channel;

  // Les salons vocaux Discord ont un chat intégré : le panneau de gestion
  // y est posté à la création. C'est le seul endroit qui a du sens — dans
  // un salon permanent, il s'adresserait à des gens sans salon à gérer.
  await channel.send({
    content: `${member}`,
    ...buildVoicePanel(),
  }).catch(() => {});

  return channel;
}

/** Supprime un salon temporaire devenu vide. */
export async function deleteTempChannel(channel) {
  await query('DELETE FROM temp_voice_channels WHERE channel_id = $1', [channel.id]);
  await channel.delete('Salon temporaire vide').catch(() => {});
}

/** Le salon est-il un vocal temporaire ? Renvoie la ligne, ou null. */
export async function findTempChannel(channelId) {
  const { rows } = await query(
    'SELECT * FROM temp_voice_channels WHERE channel_id = $1',
    [channelId],
  );
  return rows[0] ?? null;
}

/** Transfère la propriété, typiquement quand le propriétaire s'en va. */
export async function transferOwnership(channel, newOwnerId) {
  await query(
    'UPDATE temp_voice_channels SET owner_id = $2 WHERE channel_id = $1',
    [channel.id, newOwnerId],
  );

  await channel.permissionOverwrites.edit(newOwnerId, {
    ManageChannels: true,
    MoveMembers: true,
    Connect: true,
    ViewChannel: true,
  }).catch(() => {});
}

/**
 * Nettoie les salons temporaires vides au démarrage.
 *
 * Sans cette réconciliation, un redémarrage pendant qu'un salon est occupé
 * laisserait une ligne en base et un salon vide sur le serveur, que plus
 * aucun événement ne viendrait supprimer.
 */
export async function reconcileTempChannels(client) {
  const { rows } = await query('SELECT * FROM temp_voice_channels');
  let cleaned = 0;

  for (const row of rows) {
    try {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      const channel = await guild.channels.fetch(row.channel_id).catch(() => null);

      if (!channel) {
        // Salon déjà supprimé côté Discord : on retire la ligne morte.
        await query('DELETE FROM temp_voice_channels WHERE channel_id = $1', [row.channel_id]);
        cleaned++;
        continue;
      }

      if (channel.members.size === 0) {
        await deleteTempChannel(channel);
        cleaned++;
      }
    } catch (err) {
      log.debug(`Réconciliation du salon ${row.channel_id} impossible : ${err.message}`);
    }
  }

  if (cleaned > 0) log.info(`${cleaned} salon(s) vocal(aux) temporaire(s) nettoyé(s)`);
}

/**
 * Panneau de contrôle, posté dans le chat du salon vocal à sa création.
 *
 * Il vit là et nulle part ailleurs : dans un salon permanent, il
 * s'adresserait à des membres qui n'ont aucun salon à gérer.
 */
export function buildVoicePanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔊 Ton salon vocal')
    .setDescription(
      'Ce salon est à toi ! Utilise les boutons ci-dessous pour le gérer :\n\n' +
      '> ✏️ **Renommer** — change le nom de ton salon\n' +
      '> 👥 **Limite** — fixe le nombre de places\n' +
      '> 🔒 **Privé / Public** — verrouille ou ouvre l\'accès\n' +
      '> ➕ **Inviter** — autorise un membre précis\n' +
      '> 👢 **Expulser** — éjecte quelqu\'un de ton salon\n' +
      '> 👑 **Transférer** — cède la propriété\n\n' +
      'Le salon disparaîtra automatiquement quand tout le monde l\'aura quitté.',
    )
    .setFooter({ text: 'Seul le propriétaire du salon peut utiliser ces boutons.' });

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('voice:rename').setLabel('Renommer').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:limit').setLabel('Limite').setEmoji('👥').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:lock').setLabel('Privé').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('voice:unlock').setLabel('Public').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('voice:invite').setLabel('Inviter').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('voice:kick').setLabel('Expulser').setEmoji('👢').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('voice:transfer').setLabel('Transférer').setEmoji('👑').setStyle(ButtonStyle.Primary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

/**
 * Résout le salon temporaire du membre et vérifie qu'il en est propriétaire.
 * Renvoie { channel, row } ou répond une erreur et renvoie null.
 */
async function requireOwnership(interaction) {
  const channel = interaction.member.voice?.channel;

  if (!channel) {
    await interaction.reply({
      content: '⚠️ Tu dois être connecté à ton salon vocal pour le gérer.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const row = await findTempChannel(channel.id);

  if (!row) {
    await interaction.reply({
      content: '⚠️ Ce salon n\'est pas un salon personnel. Rejoins **➕ Créer un salon**.',
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  if (row.owner_id !== interaction.user.id) {
    await interaction.reply({
      content: `⛔ Seul <@${row.owner_id}> peut gérer ce salon.`,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  return { channel, row };
}

/** Routeur des boutons du panneau vocal. */
export async function handleVoiceButton(interaction, action) {
  // showModal() ne peut pas suivre un defer : ces actions répondent
  // directement par un formulaire.
  if (action === 'rename' || action === 'limit') {
    const owned = await requireOwnership(interaction);
    if (!owned) return;
    return showVoiceModal(interaction, action);
  }

  const owned = await requireOwnership(interaction);
  if (!owned) return;

  const { channel } = owned;

  switch (action) {
    case 'lock':
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        Connect: false,
      });
      return interaction.reply({
        content: '🔒 Ton salon est **privé**. Utilise **Inviter** pour autoriser quelqu\'un.',
        flags: MessageFlags.Ephemeral,
      });

    case 'unlock':
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
        Connect: null,
      });
      return interaction.reply({
        content: '🔓 Ton salon est de nouveau **public**.',
        flags: MessageFlags.Ephemeral,
      });

    case 'invite':
    case 'kick':
    case 'transfer':
      return promptMemberSelect(interaction, action, channel);

    default:
      return;
  }
}

/** Formulaire de renommage ou de limite de places. */
async function showVoiceModal(interaction, action) {
  const isRename = action === 'rename';

  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(isRename ? 'Nouveau nom du salon' : 'Nombre de places (0 = illimité)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(isRename ? 100 : 2)
    .setPlaceholder(isRename ? 'Team Ace' : '5');

  const modal = new ModalBuilder()
    .setCustomId(`voice:modal:${action}`)
    .setTitle(isRename ? 'Renommer le salon' : 'Limite de places')
    .addComponents(new ActionRowBuilder().addComponents(input));

  return interaction.showModal(modal);
}

/** Applique le formulaire de renommage / limite. */
export async function handleVoiceModal(interaction, action) {
  const owned = await requireOwnership(interaction);
  if (!owned) return;

  const { channel } = owned;
  const value = interaction.fields.getTextInputValue('value').trim();

  if (action === 'rename') {
    await channel.setName(value.slice(0, 100), 'Renommé par le propriétaire');
    return interaction.reply({
      content: `✏️ Ton salon s'appelle maintenant **${value.slice(0, 100)}**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // Les Elite disposent de la plage complète ; les autres sont bornés à 10,
  // ce qui couvre tous les formats CS2 (5v5 compris, spectateurs inclus).
  const cfg = await getGuildConfig(interaction.guild.id);
  const isElite = cfg.vip_role_id && interaction.member.roles.cache.has(cfg.vip_role_id);
  const maxLimit = isElite ? 99 : 10;

  const limit = Number.parseInt(value, 10);
  if (Number.isNaN(limit) || limit < 0 || limit > maxLimit) {
    return interaction.reply({
      content:
        `❌ Indique un nombre entre **0** (illimité) et **${maxLimit}**.` +
        (isElite ? '' : '\n💎 Les membres **Elite** peuvent monter jusqu\'à 99.'),
      flags: MessageFlags.Ephemeral,
    });
  }

  await channel.setUserLimit(limit, 'Limite modifiée par le propriétaire');
  return interaction.reply({
    content: limit === 0
      ? '👥 Ton salon accepte désormais un **nombre illimité** de membres.'
      : `👥 Ton salon est limité à **${limit}** place(s).`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Menu de sélection d'un membre pour inviter / expulser / transférer. */
async function promptMemberSelect(interaction, action, channel) {
  const { UserSelectMenuBuilder } = await import('discord.js');

  const labels = {
    invite: 'Qui veux-tu autoriser à rejoindre ?',
    kick: 'Qui veux-tu expulser du salon ?',
    transfer: 'À qui veux-tu céder ton salon ?',
  };

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`voice:member:${action}`)
      .setPlaceholder(labels[action])
      .setMinValues(1)
      .setMaxValues(1),
  );

  return interaction.reply({
    content: labels[action],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Applique l'action sur le membre choisi. */
export async function handleVoiceMemberSelect(interaction, action) {
  const owned = await requireOwnership(interaction);
  if (!owned) return;

  const { channel } = owned;
  const targetId = interaction.values[0];

  if (targetId === interaction.user.id) {
    return interaction.update({
      content: '😅 Tu ne peux pas faire ça sur toi-même.',
      components: [],
    });
  }

  const target = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    return interaction.update({ content: '❌ Membre introuvable.', components: [] });
  }

  switch (action) {
    case 'invite':
      await channel.permissionOverwrites.edit(targetId, { Connect: true, ViewChannel: true });
      await target.send(
        `🔊 ${interaction.user} t'invite dans son salon **${channel.name}** sur **${interaction.guild.name}**.`,
      ).catch(() => {});
      return interaction.update({
        content: `➕ ${target} peut désormais rejoindre ton salon.`,
        components: [],
      });

    case 'kick': {
      // Bloquer avant d'expulser : sinon le membre revient aussitôt.
      await channel.permissionOverwrites.edit(targetId, { Connect: false });
      if (target.voice?.channelId === channel.id) {
        await target.voice.disconnect('Expulsé par le propriétaire du salon').catch(() => {});
      }
      return interaction.update({
        content: `👢 ${target} a été expulsé et ne peut plus revenir.`,
        components: [],
      });
    }

    case 'transfer':
      await transferOwnership(channel, targetId);
      return interaction.update({
        content: `👑 ${target} est désormais propriétaire du salon.`,
        components: [],
      });

    default:
      return interaction.update({ content: '❌ Action inconnue.', components: [] });
  }
}
