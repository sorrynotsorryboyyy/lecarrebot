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

/**
 * /config — ajustements après coup.
 * `/setup` suffit pour un serveur neuf ; cette commande sert aux cas
 * particuliers (salons déjà existants, règlement sur mesure, seuils).
 */
export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Ajuster la configuration du CarréBot')
  .addSubcommand((s) =>
    s.setName('voir').setDescription('Afficher la configuration actuelle'))
  .addSubcommand((s) =>
    s.setName('salons')
      .setDescription('Réaffecter les salons utilisés par le bot')
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
      .setDescription('Réaffecter les rôles')
      .addRoleOption((o) =>
        o.setName('vérifié').setDescription('Rôle donné après vérification').setRequired(true))
      .addRoleOption((o) =>
        o.setName('non_vérifié').setDescription('Rôle retiré après vérification (optionnel)')))
  .addSubcommand((s) =>
    s.setName('panneau')
      .setDescription('Republier le panneau de vérification'))
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
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  switch (interaction.options.getSubcommand()) {
    case 'voir':      return showConfig(interaction);
    case 'salons':    return setChannels(interaction);
    case 'roles':     return setRoles(interaction);
    case 'panneau':   return postPanel(interaction);
    case 'règlement': return setRules(interaction);
    case 'antiraid':  return setAntiraid(interaction);
  }
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
    content: `✅ ${Object.keys(patch).length} salon(s) reconfiguré(s).`,
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
        'Déplace mon rôle plus haut dans **Paramètres du serveur → Rôles**.',
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
      content: '❌ Salon de vérification introuvable. Lance `/setup` ou `/config salons`.',
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
