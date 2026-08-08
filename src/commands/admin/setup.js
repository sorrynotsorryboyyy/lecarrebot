import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { buildVerifyPanel } from '../../handlers/verification.js';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configuration du CarréBot')
  .addSubcommand((s) =>
    s.setName('auto')
      .setDescription('Configuration automatique : crée salons et rôles manquants'))
  .addSubcommand((s) =>
    s.setName('salons')
      .setDescription('Définir les salons manuellement')
      .addChannelOption((o) =>
        o.setName('vérification').setDescription('Salon du panneau de vérification')
          .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) =>
        o.setName('règlement').setDescription('Salon du règlement')
          .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) =>
        o.setName('logs').setDescription('Salon des logs de modération')
          .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) =>
        o.setName('lfg').setDescription('Salon de recherche de mates')
          .addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) =>
    s.setName('roles')
      .setDescription('Définir les rôles')
      .addRoleOption((o) =>
        o.setName('vérifié').setDescription('Rôle donné après vérification').setRequired(true))
      .addRoleOption((o) =>
        o.setName('non_vérifié').setDescription('Rôle retiré après vérification (optionnel)')))
  .addSubcommand((s) =>
    s.setName('panneau')
      .setDescription('Publier le panneau de vérification dans le salon configuré'))
  .addSubcommand((s) =>
    s.setName('règlement')
      .setDescription('Modifier le texte du règlement')
      .addStringOption((o) =>
        o.setName('texte')
          .setDescription('Le règlement complet (\\n pour un retour à la ligne)')
          .setRequired(true)
          .setMaxLength(3500)))
  .addSubcommand((s) =>
    s.setName('antiraid')
      .setDescription('Régler la protection anti-raid')
      .addBooleanOption((o) => o.setName('activé').setDescription('Activer la protection'))
      .addIntegerOption((o) =>
        o.setName('arrivées').setDescription('Nb d\'arrivées déclenchant un lockdown (défaut 5)')
          .setMinValue(2).setMaxValue(50))
      .addIntegerOption((o) =>
        o.setName('fenêtre').setDescription('Fenêtre de détection en secondes (défaut 10)')
          .setMinValue(5).setMaxValue(300))
      .addIntegerOption((o) =>
        o.setName('âge_min').setDescription('Âge minimum du compte en jours (défaut 7)')
          .setMinValue(0).setMaxValue(365)))
  .addSubcommand((s) =>
    s.setName('voir').setDescription('Afficher la configuration actuelle'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  switch (sub) {
    case 'auto':      return autoSetup(interaction);
    case 'salons':    return setChannels(interaction);
    case 'roles':     return setRoles(interaction);
    case 'panneau':   return postPanel(interaction);
    case 'règlement': return setRules(interaction);
    case 'antiraid':  return setAntiraid(interaction);
    case 'voir':      return showConfig(interaction);
  }
}

/**
 * Configuration automatique : crée ce qui manque et verrouille le serveur
 * derrière la vérification, sans toucher à l'existant déjà configuré.
 */
async function autoSetup(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const me = guild.members.me;

  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) ||
      !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.editReply(
      '❌ Il me faut les permissions **Gérer les rôles** et **Gérer les salons** pour la configuration automatique.',
    );
  }

  const steps = [];
  const cfg = await getGuildConfig(guild.id);
  const patch = {};

  // ─── Rôle vérifié ────────────────────────────────────────────────
  let verifiedRole = cfg.verified_role_id
    ? guild.roles.cache.get(cfg.verified_role_id)
    : guild.roles.cache.find((r) => r.name === '✅ Vérifié');

  if (!verifiedRole) {
    verifiedRole = await guild.roles.create({
      name: '✅ Vérifié',
      color: 0x57f287,
      reason: 'CarréBot — configuration automatique',
    });
    steps.push(`✅ Rôle ${verifiedRole} créé`);
  } else {
    steps.push(`↩️ Rôle ${verifiedRole} réutilisé`);
  }
  patch.verified_role_id = verifiedRole.id;

  // ─── Salons ──────────────────────────────────────────────────────
  const ensureChannel = async (key, name, topic, overwrites) => {
    const existingId = cfg[key];
    let channel = existingId ? guild.channels.cache.get(existingId) : null;
    if (!channel) channel = guild.channels.cache.find((c) => c.name === name);

    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        topic,
        permissionOverwrites: overwrites,
        reason: 'CarréBot — configuration automatique',
      });
      steps.push(`✅ Salon ${channel} créé`);
    } else {
      steps.push(`↩️ Salon ${channel} réutilisé`);
    }
    patch[key] = channel.id;
    return channel;
  };

  // #verification : visible par tous, écriture interdite.
  const verifyChannel = await ensureChannel(
    'verify_channel_id', '🔐-verification',
    'Vérifie-toi ici pour accéder au serveur',
    [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      },
      {
        id: verifiedRole.id,
        deny: [PermissionFlagsBits.ViewChannel],
      },
    ],
  );

  // #reglement : lisible seulement après vérification.
  await ensureChannel(
    'rules_channel_id', '📜-reglement',
    'Le règlement du serveur',
    [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: verifiedRole.id,
        allow: [PermissionFlagsBits.ViewChannel],
        deny: [PermissionFlagsBits.SendMessages],
      },
    ],
  );

  // #logs : réservé au staff.
  await ensureChannel(
    'logs_channel_id', '📋-logs-carrebot',
    'Journal des actions du CarréBot',
    [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ],
  );

  // #recherche-mates : réservé aux vérifiés.
  await ensureChannel(
    'lfg_channel_id', '🎮-recherche-mates',
    'Trouve des coéquipiers avec /lfg',
    [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: verifiedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ],
  );

  await updateGuildConfig(guild.id, patch);

  // ─── Verrouillage des autres salons ──────────────────────────────
  // Sans cette étape, la vérification serait décorative : un arrivant
  // verrait déjà tout le serveur.
  let locked = 0;
  const managedIds = new Set(Object.values(patch));

  for (const channel of guild.channels.cache.values()) {
    if (managedIds.has(channel.id)) continue;
    if (channel.type === ChannelType.GuildCategory) continue;

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      await channel.permissionOverwrites.edit(verifiedRole, { ViewChannel: true });
      locked++;
    } catch {
      // Salon hors de portée : on continue.
    }
  }
  if (locked > 0) steps.push(`🔒 ${locked} salon(s) verrouillés derrière la vérification`);

  // ─── Panneau de vérification ─────────────────────────────────────
  await verifyChannel.send(buildVerifyPanel()).catch(() => {});
  steps.push(`📌 Panneau publié dans ${verifyChannel}`);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('✅ Configuration terminée')
    .setDescription(steps.join('\n'))
    .setFooter({
      text: 'Vérifie que le rôle du bot est bien AU-DESSUS du rôle Vérifié dans Paramètres > Rôles.',
    });

  return interaction.editReply({ embeds: [embed] });
}

async function setChannels(interaction) {
  const patch = {};
  const map = {
    'vérification': 'verify_channel_id',
    'règlement': 'rules_channel_id',
    'logs': 'logs_channel_id',
    'lfg': 'lfg_channel_id',
  };

  for (const [option, column] of Object.entries(map)) {
    const channel = interaction.options.getChannel(option);
    if (channel) patch[column] = channel.id;
  }

  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: '❌ Indique au moins un salon.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await updateGuildConfig(interaction.guild.id, patch);

  return interaction.reply({
    content: `✅ ${Object.keys(patch).length} salon(s) configuré(s).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function setRoles(interaction) {
  const verified = interaction.options.getRole('vérifié');
  const unverified = interaction.options.getRole('non_vérifié');

  const me = interaction.guild.members.me;
  if (verified.position >= me.roles.highest.position) {
    return interaction.reply({
      content:
        `⛔ Le rôle ${verified} est au-dessus du mien : je ne pourrai pas l'attribuer.\n` +
        'Déplace mon rôle plus haut dans **Paramètres du serveur > Rôles**.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await updateGuildConfig(interaction.guild.id, {
    verified_role_id: verified.id,
    ...(unverified ? { unverified_role_id: unverified.id } : {}),
  });

  return interaction.reply({
    content: `✅ Rôle vérifié : ${verified}${unverified ? `\n✅ Rôle non-vérifié : ${unverified}` : ''}`,
    flags: MessageFlags.Ephemeral,
  });
}

async function postPanel(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);

  const channelId = cfg.verify_channel_id ?? interaction.channel.id;
  const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);

  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: '❌ Salon de vérification introuvable. Configure-le avec `/setup salons`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await channel.send(buildVerifyPanel());

  return interaction.reply({
    content: `✅ Panneau publié dans ${channel}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function setRules(interaction) {
  // Les options de commande ne peuvent pas contenir de vrai saut de ligne :
  // on accepte la séquence \n littérale saisie par l'admin.
  const text = interaction.options.getString('texte').replace(/\\n/g, '\n');

  await updateGuildConfig(interaction.guild.id, { rules_text: text });

  return interaction.reply({
    content: '✅ Règlement mis à jour. Il sera affiché lors des prochaines vérifications.',
    flags: MessageFlags.Ephemeral,
  });
}

async function setAntiraid(interaction) {
  const patch = {};
  const enabled = interaction.options.getBoolean('activé');
  const joins = interaction.options.getInteger('arrivées');
  const window = interaction.options.getInteger('fenêtre');
  const minAge = interaction.options.getInteger('âge_min');

  if (enabled !== null) patch.antiraid_enabled = enabled;
  if (joins !== null) patch.antiraid_joins = joins;
  if (window !== null) patch.antiraid_window = window;
  if (minAge !== null) patch.antiraid_min_age = minAge;

  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: '❌ Indique au moins un réglage à modifier.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await updateGuildConfig(interaction.guild.id, patch);

  return interaction.reply({
    content:
      `✅ Anti-raid mis à jour :\n` +
      `• Protection : **${cfg.antiraid_enabled ? 'activée' : 'désactivée'}**\n` +
      `• Seuil : **${cfg.antiraid_joins} arrivées / ${cfg.antiraid_window}s**\n` +
      `• Âge minimum du compte : **${cfg.antiraid_min_age} jour(s)**`,
    flags: MessageFlags.Ephemeral,
  });
}

async function showConfig(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);

  const ref = (id, type) => (id ? (type === 'role' ? `<@&${id}>` : `<#${id}>`) : '*non configuré*');

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⚙️ Configuration du CarréBot')
    .addFields(
      {
        name: '📁 Salons',
        value:
          `Vérification : ${ref(cfg.verify_channel_id)}\n` +
          `Règlement : ${ref(cfg.rules_channel_id)}\n` +
          `Logs : ${ref(cfg.logs_channel_id)}\n` +
          `Recherche de mates : ${ref(cfg.lfg_channel_id)}`,
      },
      {
        name: '🎭 Rôles',
        value:
          `Vérifié : ${ref(cfg.verified_role_id, 'role')}\n` +
          `Non vérifié : ${ref(cfg.unverified_role_id, 'role')}`,
      },
      {
        name: '🛡️ Anti-raid',
        value:
          `Protection : **${cfg.antiraid_enabled ? '✅ activée' : '❌ désactivée'}**\n` +
          `Seuil : **${cfg.antiraid_joins} arrivées / ${cfg.antiraid_window}s**\n` +
          `Âge minimum : **${cfg.antiraid_min_age} jour(s)**\n` +
          `Lockdown : **${cfg.lockdown_active ? '🚨 ACTIF' : 'inactif'}**`,
      },
      {
        name: '📜 Règlement',
        value: cfg.rules_text ? '*personnalisé*' : '*par défaut*',
      },
    );

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
