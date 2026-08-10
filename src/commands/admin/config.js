import {
  ActionRowBuilder,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { parseJsonColumn } from '../../lib/jsonColumn.js';
import { isValidUrl } from '../../lib/publication.js';
import { CHANNEL_CONFIG_KEYS } from '../../lib/blueprint.js';
import { DEFAULT_RULES } from '../../handlers/verification.js';
import { MEDIA_POLICIES } from '../../lib/mediaPolicy.js';

/**
 * /config — pilote le bot sans redéployer.
 *
 * Tout ce qui vivait en dur dans le code (règlement, seuils anti-raid,
 * salons cibles, politiques média) se règle ici et vit en base. Les
 * écritures passent par `updateGuildConfig`, dont la liste blanche empêche
 * de viser une colonne arbitraire.
 */
export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Réglages du bot')
  .addSubcommand((s) =>
    s.setName('voir').setDescription('Voir la configuration actuelle'))
  .addSubcommand((s) =>
    s.setName('reglement').setDescription('Modifier le texte du règlement'))
  .addSubcommand((s) =>
    s.setName('antiraid')
      .setDescription('Régler la protection anti-raid')
      .addBooleanOption((o) =>
        o.setName('actif').setDescription('Activer la protection'))
      .addIntegerOption((o) =>
        o.setName('arrivees')
          .setDescription('Arrivées simultanées déclenchant l\'alerte (défaut : 5)')
          .setMinValue(2).setMaxValue(50))
      .addIntegerOption((o) =>
        o.setName('fenetre')
          .setDescription('Fenêtre de détection en secondes (défaut : 10)')
          .setMinValue(5).setMaxValue(300))
      .addIntegerOption((o) =>
        o.setName('age_min')
          .setDescription('Âge minimum d\'un compte, en jours (défaut : 7)')
          .setMinValue(0).setMaxValue(90)))
  .addSubcommand((s) =>
    s.setName('salon')
      .setDescription('Rattacher un salon à une fonction du bot')
      .addStringOption((o) =>
        o.setName('fonction')
          .setDescription('Quelle fonction ?')
          .setRequired(true)
          .addChoices(
            { name: 'Vérification',        value: 'verify' },
            { name: 'Journal (logs)',      value: 'logs' },
            { name: 'Recherche de mates',  value: 'lfg' },
            { name: 'Bienvenue',           value: 'welcome' },
            { name: 'Rôles',               value: 'roles' },
          ))
      .addChannelOption((o) =>
        o.setName('salon')
          .setDescription('Le salon à utiliser')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)))
  .addSubcommand((s) =>
    s.setName('media')
      .setDescription('Régler ce qui est autorisé dans un salon')
      .addChannelOption((o) =>
        o.setName('salon')
          .setDescription('Le salon concerné')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true))
      .addStringOption((o) =>
        o.setName('politique')
          .setDescription('Que peut-on y poster ?')
          .setRequired(true)
          .addChoices(
            { name: 'Tout autorisé',                value: 'free' },
            { name: 'GIF seulement (discussion)',   value: 'discussion' },
            { name: 'Vidéos et liens seulement',    value: 'clips' },
            { name: 'Aucune restriction (annuler)', value: 'none' },
          )))
  .addSubcommand((s) =>
    s.setName('banniere')
      .setDescription('Bannière par défaut d\'un type de publication')
      .addStringOption((o) =>
        o.setName('type')
          .setDescription('Type de publication')
          .setRequired(true)
          .addChoices(
            { name: 'Annonce',  value: 'annonce' },
            { name: 'News CS2', value: 'news' },
            { name: 'KlipIt',   value: 'klipit' },
            { name: 'Tournoi',  value: 'tournoi' },
            { name: 'Giveaway', value: 'giveaway' },
          ))
      .addStringOption((o) =>
        o.setName('image')
          .setDescription('Lien de l\'image (vide pour retirer)')
          .setMaxLength(500)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'voir') return showConfig(interaction);
  // showModal() ne peut pas suivre un defer : on ouvre directement.
  if (sub === 'reglement') return openRulesEditor(interaction);
  if (sub === 'antiraid') return setAntiraid(interaction);
  if (sub === 'salon') return setChannel(interaction);
  if (sub === 'media') return setMedia(interaction);
  if (sub === 'banniere') return setBanner(interaction);
}

/** Vue d'ensemble de la configuration. */
async function showConfig(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);
  const channels = parseJsonColumn(cfg.channel_ids);
  const ranks = parseJsonColumn(cfg.rank_roles);
  const identity = parseJsonColumn(cfg.identity_roles);
  const media = parseJsonColumn(cfg.media_policies);
  const banners = parseJsonColumn(cfg.default_banners);

  const chan = (id) => (id ? `<#${id}>` : '*non défini*');
  const role = (id) => (id ? `<@&${id}>` : '*non défini*');

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('⚙️ Configuration du serveur')
    .addFields(
      {
        name: '📁 Salons',
        value:
          `Vérification : ${chan(cfg.verify_channel_id)}\n` +
          `Journal : ${chan(cfg.logs_channel_id)}\n` +
          `Recherche : ${chan(cfg.lfg_channel_id)}\n` +
          `Bienvenue : ${chan(cfg.welcome_channel_id)}\n` +
          `Rôles : ${chan(cfg.roles_channel_id)}`,
        inline: true,
      },
      {
        name: '🎭 Rôles',
        value:
          `Membre : ${role(cfg.verified_role_id)}\n` +
          `Non vérifié : ${role(cfg.unverified_role_id)}\n` +
          `Elite : ${role(cfg.vip_role_id)}\n` +
          `Losange : ${role(cfg.losange_role_id)}`,
        inline: true,
      },
      {
        name: '🛡️ Anti-raid',
        value:
          `État : ${cfg.antiraid_enabled ? '✅ actif' : '❌ inactif'}\n` +
          `Seuil : **${cfg.antiraid_joins}** arrivées / **${cfg.antiraid_window}** s\n` +
          `Âge minimum : **${cfg.antiraid_min_age}** jours\n` +
          `Lockdown : ${cfg.lockdown_active ? '🔒 **EN COURS**' : 'inactif'}`,
      },
      {
        name: '📊 Éléments enregistrés',
        value:
          `**${Object.keys(channels).length}** salons · ` +
          `**${Object.keys(ranks).length}** rangs · ` +
          `**${Object.keys(identity).length}** rôles d'identité`,
        inline: true,
      },
      {
        name: '📝 Règlement',
        value: cfg.rules_text
          ? `Personnalisé (**${cfg.rules_text.length}** caractères)`
          : `Par défaut (**${DEFAULT_RULES.length}** points)`,
        inline: true,
      },
    );

  // Surcharges média : on ne montre la section que si elle a du contenu.
  const overrides = Object.entries(media);
  if (overrides.length > 0) {
    embed.addFields({
      name: '🖼️ Politiques média personnalisées',
      value: overrides
        .map(([id, p]) => `<#${id}> → **${p === 'none' ? 'aucune restriction' : p}**`)
        .join('\n')
        .slice(0, 1024),
    });
  }

  const bannerList = Object.entries(banners);
  if (bannerList.length > 0) {
    embed.addFields({
      name: '🏞️ Bannières par défaut',
      value: bannerList.map(([k]) => `**${k}**`).join(' · '),
    });
  }

  embed.setFooter({ text: 'Modifie ces réglages avec les sous-commandes de /config.' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Éditeur du règlement.
 *
 * Un formulaire, pas une option de commande : le règlement est un texte
 * multi-ligne de plusieurs milliers de caractères, impossible à saisir
 * confortablement dans une option slash.
 */
async function openRulesEditor(interaction) {
  const cfg = await getGuildConfig(interaction.guild.id);
  const current = cfg.rules_text ?? DEFAULT_RULES.join('\n');

  const modal = new ModalBuilder()
    .setCustomId('config:rules:save')
    .setTitle('Règlement du serveur');

  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder()
      .setCustomId('rules')
      .setLabel('Texte du règlement (Markdown accepté)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(3800)
      .setValue(current.slice(0, 3800)),
  ));

  return interaction.showModal(modal);
}

/** Enregistrement du règlement saisi. */
export async function saveRules(interaction) {
  const text = interaction.fields.getTextInputValue('rules').trim();

  await updateGuildConfig(interaction.guild.id, { rules_text: text });

  return interaction.reply({
    content:
      '✅ Règlement mis à jour. Il s\'applique dès la prochaine vérification.\n' +
      '*Le panneau déjà publié n\'a pas besoin d\'être republié : le texte est lu à chaque fois.*',
    flags: MessageFlags.Ephemeral,
  });
}

/** Réglages anti-raid. */
async function setAntiraid(interaction) {
  const patch = {};

  const enabled = interaction.options.getBoolean('actif');
  const joins = interaction.options.getInteger('arrivees');
  const window = interaction.options.getInteger('fenetre');
  const minAge = interaction.options.getInteger('age_min');

  if (enabled !== null) patch.antiraid_enabled = enabled;
  if (joins !== null) patch.antiraid_joins = joins;
  if (window !== null) patch.antiraid_window = window;
  if (minAge !== null) patch.antiraid_min_age = minAge;

  if (Object.keys(patch).length === 0) {
    return interaction.reply({
      content: 'ℹ️ Aucun réglage fourni. Utilise `/config voir` pour l\'état actuel.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await updateGuildConfig(interaction.guild.id, patch);

  return interaction.reply({
    content:
      '✅ Anti-raid mis à jour :\n' +
      `> État : ${cfg.antiraid_enabled ? '✅ actif' : '❌ inactif'}\n` +
      `> Seuil : **${cfg.antiraid_joins}** arrivées en **${cfg.antiraid_window}** s\n` +
      `> Âge minimum : **${cfg.antiraid_min_age}** jours`,
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Rattache un salon à une fonction.
 *
 * Écrit la colonne dédiée ET l'entrée de `channel_ids` : cette dernière est
 * la source de vérité de la politique média et du panneau de publication.
 * N'écrire que la colonne laisserait ces deux-là viser l'ancien salon.
 */
async function setChannel(interaction) {
  const key = interaction.options.getString('fonction');
  const channel = interaction.options.getChannel('salon');

  const column = CHANNEL_CONFIG_KEYS[key];
  if (!column) {
    return interaction.reply({
      content: '❌ Fonction inconnue.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  channelIds[key] = channel.id;

  await updateGuildConfig(interaction.guild.id, {
    [column]: channel.id,
    channel_ids: JSON.stringify(channelIds),
  });

  return interaction.reply({
    content: `✅ ${channel} est maintenant le salon **${key}**.`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Politique média d'un salon. */
async function setMedia(interaction) {
  const channel = interaction.options.getChannel('salon');
  const policy = interaction.options.getString('politique');

  const cfg = await getGuildConfig(interaction.guild.id);
  const overrides = parseJsonColumn(cfg.media_policies);

  if (policy === 'none') {
    // `'none'` est enregistré, pas effacé : il annule explicitement la
    // politique du plan, ce qu'une simple absence ne ferait pas.
    overrides[channel.id] = 'none';
  } else if (!MEDIA_POLICIES[policy]) {
    return interaction.reply({
      content: '❌ Politique inconnue.',
      flags: MessageFlags.Ephemeral,
    });
  } else {
    overrides[channel.id] = policy;
  }

  await updateGuildConfig(interaction.guild.id, {
    media_policies: JSON.stringify(overrides),
  });

  const label = {
    free: 'tout autorisé',
    discussion: 'GIF seulement',
    clips: 'vidéos et liens seulement',
    none: 'aucune restriction',
  }[policy];

  return interaction.reply({
    content:
      `✅ Dans ${channel} : **${label}**.\n` +
      '*Le staff et les membres Elite ne sont jamais filtrés.*',
    flags: MessageFlags.Ephemeral,
  });
}

/** Bannière par défaut d'un type de publication. */
async function setBanner(interaction) {
  const type = interaction.options.getString('type');
  const image = interaction.options.getString('image')?.trim() || null;

  if (image && !isValidUrl(image)) {
    return interaction.reply({
      content: '❌ Le lien doit commencer par `http://` ou `https://`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);
  const banners = parseJsonColumn(cfg.default_banners);

  if (image) banners[type] = image;
  else delete banners[type];

  await updateGuildConfig(interaction.guild.id, {
    default_banners: JSON.stringify(banners),
  });

  return interaction.reply({
    content: image
      ? `✅ Bannière par défaut de **${type}** enregistrée.`
      : `✅ Bannière par défaut de **${type}** retirée.`,
    flags: MessageFlags.Ephemeral,
  });
}
