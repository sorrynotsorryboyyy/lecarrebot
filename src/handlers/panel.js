import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { log } from '../lib/logger.js';

/**
 * Panel de publication.
 *
 * Permet de composer une annonce dans un formulaire, de la prévisualiser,
 * puis de la publier dans le bon salon — sans commande à rallonge ni
 * risque de publier une coquille.
 *
 * Les brouillons vivent en mémoire : ils n'ont de sens que le temps de la
 * rédaction, et un redémarrage doit les oublier.
 */
const drafts = new Map();

const draftKey = (guildId, userId) => `${guildId}:${userId}`;

/** Types publiables, avec leur salon cible et leur couleur par défaut. */
export const PANEL_TYPES = {
  annonce: {
    id: 'annonce',
    label: '📢 Annonce',
    description: 'Publier une annonce importante',
    channelKey: 'announcements',
    color: COLORS.primary,
    mention: true,
  },
  news: {
    id: 'news',
    label: '📰 News CS2',
    description: 'Publier une actualité Counter-Strike 2',
    channelKey: 'cs2',
    color: 0xf0a500,
    mention: false,
  },
  vote: {
    id: 'vote',
    label: '🗳️ Panneau de vote',
    description: 'Publier le panneau de vote top-serveurs',
    channelKey: 'vote',
    color: 0x9b59b6,
    mention: false,
  },
};

/** Menu principal de /panel. */
export function buildPanelMenu() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🛠️ Panel de publication')
    .setDescription(
      'Choisis ce que tu veux publier. Un formulaire s\'ouvrira, puis tu ' +
      'pourras **prévisualiser** avant de publier.\n\n' +
      'Pour les tournois et giveaways, utilise `/tournoi créer` et ' +
      '`/giveaway lancer` — ils gèrent les inscriptions et les tirages.',
    );

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:type:choose')
      .setPlaceholder('Que veux-tu publier ?')
      .addOptions(
        Object.values(PANEL_TYPES).map((t) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.id)
            .setDescription(t.description)),
      ),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Ouvre le formulaire correspondant au type choisi.
 * `showModal` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openComposer(interaction, typeId) {
  const type = PANEL_TYPES[typeId];
  if (!type) return;

  const modal = new ModalBuilder()
    .setCustomId(`panel:submit:${typeId}`)
    .setTitle(type.label.replace(/^\S+\s/, '').slice(0, 45));

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Titre')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(256)
    .setPlaceholder('Maintenance du serveur');

  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Contenu')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(3500)
    .setPlaceholder('Décris ici ton annonce. Les sauts de ligne sont conservés.');

  const image = new TextInputBuilder()
    .setCustomId('image')
    .setLabel('Image (lien, facultatif)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('https://…');

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(body),
    new ActionRowBuilder().addComponents(image),
  );

  return interaction.showModal(modal);
}

/** Construit l'embed final à partir d'un brouillon. */
function buildDraftEmbed(draft) {
  const type = PANEL_TYPES[draft.type];

  const embed = new EmbedBuilder()
    .setColor(type.color)
    .setTitle(draft.title)
    .setDescription(draft.body)
    .setTimestamp();

  // Une image invalide ferait échouer l'envoi : on ne la retient que si
  // elle ressemble à une URL http(s).
  if (draft.image && /^https?:\/\/\S+$/i.test(draft.image)) {
    embed.setImage(draft.image);
  }

  return embed;
}

/** Réception du formulaire : on affiche un aperçu, on ne publie pas encore. */
export async function receiveComposer(interaction, typeId) {
  const type = PANEL_TYPES[typeId];
  if (!type) return;

  const draft = {
    type: typeId,
    title: interaction.fields.getTextInputValue('title').trim(),
    body: interaction.fields.getTextInputValue('body').trim(),
    image: interaction.fields.getTextInputValue('image')?.trim() ?? '',
  };

  drafts.set(draftKey(interaction.guild.id, interaction.user.id), draft);

  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = channelIds[type.channelKey];

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:publish:go')
      .setLabel('Publier')
      .setEmoji('📤')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!targetId),
    new ButtonBuilder()
      .setCustomId(`panel:edit:${typeId}`)
      .setLabel('Modifier')
      .setEmoji('✏️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('panel:cancel:x')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Danger),
  );

  const notice = targetId
    ? `Aperçu — sera publié dans <#${targetId}>`
    : '⚠️ Salon cible introuvable. Relance `/setup` avant de publier.';

  return interaction.reply({
    content: notice,
    embeds: [buildDraftEmbed(draft)],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Publication effective du brouillon. */
export async function publishDraft(interaction) {
  const key = draftKey(interaction.guild.id, interaction.user.id);
  const draft = drafts.get(key);

  if (!draft) {
    return interaction.update({
      content: '⏱️ Ce brouillon a expiré. Relance `/panel`.',
      embeds: [], components: [],
    });
  }

  const type = PANEL_TYPES[draft.type];
  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = channelIds[type.channelKey];

  try {
    const channel = await interaction.guild.channels.fetch(targetId);

    await channel.send({
      // Les annonces méritent une notification ; le reste non.
      content: type.mention ? '@everyone' : undefined,
      embeds: [buildDraftEmbed(draft)],
      allowedMentions: { parse: type.mention ? ['everyone'] : [] },
    });

    drafts.delete(key);

    return interaction.update({
      content: `✅ Publié dans ${channel} !`,
      embeds: [], components: [],
    });
  } catch (err) {
    log.warn(`Publication impossible : ${err.message}`);
    return interaction.update({
      content: `❌ Publication impossible : ${err.message}`,
      embeds: [], components: [],
    });
  }
}

/** Abandon du brouillon. */
export function cancelDraft(interaction) {
  drafts.delete(draftKey(interaction.guild.id, interaction.user.id));
  return interaction.update({
    content: '🗑️ Brouillon abandonné.',
    embeds: [], components: [],
  });
}
