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
import { getGuildConfig, query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { parseDuration } from '../lib/time.js';
import { buildGiveawayMessage, buildTournamentMessage } from '../lib/embeds.js';
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
      .addOptions([
        ...Object.values(PANEL_TYPES).map((t) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(t.label)
            .setValue(t.id)
            .setDescription(t.description)),
        // La stratégie a ses propres champs (carte, côté) : elle est
        // routée vers le formulaire de /strat plutôt que vers le
        // composeur générique.
        new StringSelectMenuOptionBuilder()
          .setLabel('📊 Stratégie CS2')
          .setValue('strat')
          .setDescription('Publier une strat ou un line-up'),
        new StringSelectMenuOptionBuilder()
          .setLabel('🏆 Tournoi')
          .setValue('tournoi')
          .setDescription('Créer un tournoi avec inscriptions'),
        new StringSelectMenuOptionBuilder()
          .setLabel('🎁 Giveaway')
          .setValue('giveaway')
          .setDescription('Lancer un giveaway avec tirage automatique'),
      ]),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Ouvre le formulaire correspondant au type choisi.
 * `showModal` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openComposer(interaction, typeId) {
  // La stratégie exige carte et côté avant le texte : on passe par un
  // second menu plutôt que d'entasser 5 champs dans un formulaire.
  if (typeId === 'strat') return openStratPicker(interaction);
  if (typeId === 'tournoi') return openEventComposer(interaction, 'tournoi');
  if (typeId === 'giveaway') return openEventComposer(interaction, 'giveaway');

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

/**
 * Formulaire de création d'un tournoi ou d'un giveaway.
 *
 * Ces deux-là créent des objets vivants (inscriptions, tirage) et non un
 * simple message : ils passent par leur propre chemin de publication, pas
 * par l'aperçu générique.
 */
async function openEventComposer(interaction, kind) {
  const isTournament = kind === 'tournoi';

  const modal = new ModalBuilder()
    .setCustomId(`panel:event:${kind}`)
    .setTitle(isTournament ? 'Nouveau tournoi' : 'Nouveau giveaway');

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel(isTournament ? 'Nom du tournoi' : 'Lot à gagner')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(200)
        .setPlaceholder(isTournament ? 'Coupe d\'été 5v5' : 'Skin AK-47 Redline'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('when')
        .setLabel(isTournament ? 'Début dans… (ex : 2d, 12h)' : 'Durée (ex : 24h, 3d)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(20)
        .setPlaceholder(isTournament ? '3d' : '24h'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('extra')
        .setLabel(isTournament ? 'Nombre d\'équipes (vide = illimité)' : 'Nombre de gagnants')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(3)
        .setPlaceholder(isTournament ? '8' : '1'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel(isTournament ? 'Détails, règles, lots' : 'Conditions (sépare par « | »)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
        .setPlaceholder(isTournament
          ? 'Format 5v5, BO3 en finale, lot : 50€'
          : 'Inviter 10 personnes | Être VIP'),
    ),
  );

  return interaction.showModal(modal);
}

/**
 * Sélection de la carte pour une stratégie.
 * Le côté (T / CT / les deux) est demandé ensuite, puis le formulaire.
 */
async function openStratPicker(interaction) {
  const { MAPS } = await import('../commands/admin/strat.js');

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('panel:strat:map')
      .setPlaceholder('Sur quelle carte ?')
      .addOptions(MAPS.map((m) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(m.name)
          .setValue(m.value)
          .setEmoji(m.emoji))),
  );

  return interaction.reply({
    content: '📊 Choisis la carte de ta stratégie :',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Deuxième étape : le côté concerné. */
export async function openStratSidePicker(interaction) {
  const map = interaction.values[0];

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      // La carte voyage dans le customId : `panel:stratside:<carte>`.
      .setCustomId(`panel:stratside:${map}`)
      .setPlaceholder('Quel côté ?')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Terroristes (T)').setValue('T').setEmoji('🔥'),
        new StringSelectMenuOptionBuilder().setLabel('Anti-terroristes (CT)').setValue('CT').setEmoji('🛡️'),
        new StringSelectMenuOptionBuilder().setLabel('Les deux côtés').setValue('Both').setEmoji('⚔️'),
      ),
  );

  return interaction.update({
    content: `📊 **${map}** — choisis le côté :`,
    components: [row],
  });
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

/**
 * Réception du formulaire tournoi / giveaway : création et publication.
 *
 * On réutilise les constructeurs d'embeds existants pour que le résultat
 * soit identique à celui des commandes, boutons d'inscription compris.
 */
export async function receiveEvent(interaction, kind) {
  const isTournament = kind === 'tournoi';

  const title = interaction.fields.getTextInputValue('title').trim();
  const when = interaction.fields.getTextInputValue('when').trim();
  const extraRaw = interaction.fields.getTextInputValue('extra')?.trim() || '';
  const description = interaction.fields.getTextInputValue('description')?.trim() || null;

  const ms = parseDuration(when);
  if (ms === null) {
    return interaction.reply({
      content: '❌ Durée invalide. Utilise par exemple `2d`, `12h`, `90m` ou `1d6h`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = channelIds[isTournament ? 'tournaments' : 'giveaways'];

  const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);
  if (!channel?.isTextBased()) {
    return interaction.reply({
      content: '⚠️ Le salon cible est introuvable. Relance `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const extra = extraRaw ? Number.parseInt(extraRaw, 10) : null;
  if (extraRaw && (Number.isNaN(extra) || extra < 1)) {
    return interaction.reply({
      content: `❌ ${isTournament ? 'Le nombre d\'équipes' : 'Le nombre de gagnants'} doit être un nombre positif.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (isTournament) {
      const startsAt = new Date(Date.now() + ms);

      const { rows } = await query(
        `INSERT INTO tournaments
           (guild_id, channel_id, name, description, format, max_teams, starts_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          interaction.guild.id, channel.id, title, description,
          '5v5', extra, startsAt, interaction.user.id,
        ],
      );
      const id = rows[0].id;

      const message = await channel.send(buildTournamentMessage({
        id, name: title, description, format: '5v5',
        maxTeams: extra, startsAt, signups: [], status: 'open',
      }));

      await query('UPDATE tournaments SET message_id = $2 WHERE id = $1', [id, message.id]);

      return interaction.reply({
        content: `🏆 Tournoi **${title}** publié dans ${channel} (ID \`${id}\`).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const endsAt = new Date(Date.now() + ms);
    const winners = extra ?? 1;

    const { rows } = await query(
      `INSERT INTO giveaways
         (guild_id, channel_id, prize, winners, ends_at, created_by, conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [interaction.guild.id, channel.id, title, winners, endsAt, interaction.user.id, description],
    );
    const id = rows[0].id;

    const message = await channel.send(buildGiveawayMessage({
      id, prize: title, winners, endsAt, entries: 0, ended: false,
      conditions: description,
    }));

    await query('UPDATE giveaways SET message_id = $2 WHERE id = $1', [id, message.id]);

    return interaction.reply({
      content: `🎁 Giveaway **${title}** lancé dans ${channel} (ID \`${id}\`).`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.warn(`Publication de l'événement impossible : ${err.message}`);
    return interaction.reply({
      content: `❌ Publication impossible : ${err.message}`,
      flags: MessageFlags.Ephemeral,
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
