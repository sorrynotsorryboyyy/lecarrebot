import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getGuildConfig, query } from '../db/index.js';
import { COLORS } from '../lib/config.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { parseDuration } from '../lib/time.js';
import { createGiveaway, createTournament } from '../lib/events.js';
import {
  buildPublication,
  isValidUrl,
  sendPublication,
  validatePublication,
} from '../lib/publication.js';
import { log } from '../lib/logger.js';

/**
 * Panneau de publication.
 *
 * Point d'entrée unique pour tout ce que le staff publie : annonces, news,
 * tournois, giveaways, stratégies. Un formulaire recueille l'essentiel, puis
 * l'aperçu — rendu réel, pas une approximation — permet de compléter champ
 * par champ avant d'envoyer.
 *
 * Discord plafonne un formulaire à 5 champs : c'est cette limite qui impose
 * le va-et-vient par l'aperçu plutôt qu'un formulaire unique à rallonge.
 *
 * Les brouillons vivent EN BASE et non en mémoire : un redéploiement Railway
 * ne doit pas faire perdre une annonce en cours de rédaction, et c'est le
 * prérequis de la publication programmée.
 */

/** Types publiables, avec leur salon cible et leur couleur par défaut. */
export const PANEL_TYPES = {
  annonce: {
    id: 'annonce',
    label: '📢 Annonce',
    description: 'Publier une annonce importante',
    channelKey: 'announcements',
    color: COLORS.primary,
    defaultMention: 'everyone',
  },
  news: {
    id: 'news',
    label: '📰 News CS2',
    description: 'Publier une actualité Counter-Strike 2',
    // Le salon 📰-news-cs2 a été retiré du plan : sans flux automatisé il
    // restait vide. Les actualités vont dans les annonces, sans notifier.
    channelKey: 'announcements',
    color: 0xf0a500,
    defaultMention: null,
  },
  klipit: {
    id: 'klipit',
    label: '🎞️ KlipIt',
    description: 'Actualité du projet KlipIt',
    channelKey: 'klipit-soon',
    color: 0x7c5cff,
    defaultMention: null,
  },
};

/** Couleurs proposées à la composition. */
const COLOR_CHOICES = [
  { label: 'Bleu (défaut)', value: String(COLORS.primary), emoji: '🔵' },
  { label: 'Vert', value: String(COLORS.success), emoji: '🟢' },
  { label: 'Jaune', value: String(COLORS.warning), emoji: '🟡' },
  { label: 'Rouge', value: String(COLORS.danger), emoji: '🔴' },
  { label: 'Orange', value: '16750848', emoji: '🟠' },
  { label: 'Violet KlipIt', value: '8150271', emoji: '🟣' },
  { label: 'Gris', value: String(COLORS.info), emoji: '⚫' },
];

/** Panneau permanent publié dans #🛠️-panel-staff par /setup. */
export function buildPanelMenu() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🛠️ Panneau de publication')
    .setDescription(
      'Choisis ce que tu veux publier. Un formulaire s\'ouvre, puis un ' +
      '**aperçu** te permet d\'ajouter une image, un lien, une couleur, ' +
      'une mention ou de programmer l\'envoi.\n\n' +
      '> 📢 **Annonce** — message important, notifie le serveur\n' +
      '> 📰 **News CS2** — actualité du jeu, sans notification\n' +
      '> 🎞️ **KlipIt** — avancement du projet\n' +
      '> 🏆 **Tournoi** — avec inscriptions par bouton\n' +
      '> 🎁 **Giveaway** — avec tirage automatique\n' +
      '> 📊 **Stratégie** — line-up ou tactique CS2',
    )
    .setFooter({ text: 'Rien n\'est publié avant ta confirmation.' });

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
        // routée vers un second menu plutôt que vers le composeur générique.
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

// ───────────────────────── Brouillons ─────────────────────────

/** Récupère le brouillon en cours d'un rédacteur, s'il existe. */
async function getDraft(guildId, userId) {
  const { rows } = await query(
    `SELECT * FROM publications
      WHERE guild_id = $1 AND created_by = $2 AND published = FALSE
      ORDER BY id DESC LIMIT 1`,
    [guildId, userId],
  );
  return rows[0] ?? null;
}

/**
 * Crée ou remplace le brouillon d'un rédacteur.
 * Un seul à la fois : ouvrir un nouveau formulaire abandonne le précédent,
 * ce qui évite de se retrouver avec une pile de brouillons oubliés.
 */
async function saveDraft(guildId, userId, data) {
  await query(
    `DELETE FROM publications
      WHERE guild_id = $1 AND created_by = $2 AND published = FALSE AND publish_at IS NULL`,
    [guildId, userId],
  );

  const { rows } = await query(
    `INSERT INTO publications
       (guild_id, kind, channel_id, title, body, image_url, link_url,
        link_label, color, mention, fields, extra, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      guildId, data.kind, data.channelId ?? null, data.title ?? '', data.body ?? null,
      data.imageUrl ?? null, data.linkUrl ?? null, data.linkLabel ?? null,
      data.color ?? null, data.mention ?? null,
      JSON.stringify(data.fields ?? []), JSON.stringify(data.extra ?? {}),
      userId,
    ],
  );

  return rows[0];
}

/** Met à jour une partie du brouillon. */
async function patchDraft(id, patch) {
  const allowed = new Set([
    'title', 'body', 'image_url', 'link_url', 'link_label',
    'color', 'mention', 'fields', 'extra', 'publish_at', 'channel_id',
  ]);

  const entries = Object.entries(patch).filter(([k]) => allowed.has(k));
  if (entries.length === 0) return null;

  const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await query(
    `UPDATE publications SET ${sets} WHERE id = $1 RETURNING *`,
    [id, ...entries.map(([, v]) => v)],
  );

  return rows[0];
}

/**
 * Traduit une ligne de la table en objet de publication.
 *
 * `fields` est un tableau JSONB : `parseJsonColumn` est taillé pour les
 * objets et renverrait `{}` ici, on le lit donc directement.
 */
function toPublication(row) {
  let fields = row.fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch { fields = []; }
  }

  return {
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    color: row.color,
    mention: row.mention,
    fields: Array.isArray(fields) ? fields : [],
  };
}

// ───────────────────────── Composition ─────────────────────────

/**
 * Ouvre le formulaire correspondant au type choisi.
 * `showModal` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openComposer(interaction, typeId) {
  if (typeId === 'strat') return openStratPicker(interaction);
  if (typeId === 'tournoi') return openEventComposer(interaction, 'tournoi');
  if (typeId === 'giveaway') return openEventComposer(interaction, 'giveaway');

  const type = PANEL_TYPES[typeId];
  if (!type) return;

  const existing = await getDraft(interaction.guild.id, interaction.user.id);
  const reuse = existing?.kind === typeId ? existing : null;

  const modal = new ModalBuilder()
    .setCustomId(`panel:submit:${typeId}`)
    .setTitle(type.label.replace(/^\S+\s/, '').slice(0, 45));

  const title = new TextInputBuilder()
    .setCustomId('title')
    .setLabel('Titre')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(240)
    .setPlaceholder('Maintenance du serveur');

  const body = new TextInputBuilder()
    .setCustomId('body')
    .setLabel('Contenu')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(3000)
    .setPlaceholder('Décris ici ton annonce. Les sauts de ligne sont conservés.');

  const image = new TextInputBuilder()
    .setCustomId('image')
    .setLabel('Image en haut (lien, facultatif)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('https://…');

  const link = new TextInputBuilder()
    .setCustomId('link')
    .setLabel('Lien d\'un bouton (facultatif)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(500)
    .setPlaceholder('https://…');

  // Re-remplit les champs quand on revient corriger : retaper une annonce
  // entière pour changer un mot serait pénible.
  if (reuse) {
    if (reuse.title) title.setValue(reuse.title);
    if (reuse.body) body.setValue(reuse.body);
    if (reuse.image_url) image.setValue(reuse.image_url);
    if (reuse.link_url) link.setValue(reuse.link_url);
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(title),
    new ActionRowBuilder().addComponents(body),
    new ActionRowBuilder().addComponents(image),
    new ActionRowBuilder().addComponents(link),
  );

  return interaction.showModal(modal);
}

/**
 * Formulaire de création d'un tournoi ou d'un giveaway.
 *
 * Ces deux-là créent des objets vivants (inscriptions, tirage) : ils passent
 * par le moteur commun `lib/events.js`, pas par l'aperçu générique.
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
        .setLabel(isTournament ? 'Format (5v5, 2v2, 1v1, Event)' : 'Nombre de gagnants')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setPlaceholder(isTournament ? '5v5' : '1'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('limit')
        .setLabel(isTournament ? 'Nombre d\'équipes (vide = illimité)' : 'Réservé aux Elite ? (oui/non)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setPlaceholder(isTournament ? '8' : 'non'),
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
          : 'Être actif sur le serveur | Avoir 18 ans'),
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

// ───────────────────────── Aperçu ─────────────────────────

/**
 * Construit l'aperçu : le rendu RÉEL de la publication, suivi des boutons
 * d'édition. Le rédacteur voit exactement ce qui sera envoyé.
 */
async function buildPreview(guild, draft) {
  const type = PANEL_TYPES[draft.kind];
  const channelIds = parseJsonColumn((await getGuildConfig(guild.id)).channel_ids);
  const targetId = draft.channel_id ?? channelIds[type?.channelKey];

  const problems = validatePublication(toPublication(draft));
  const scheduled = draft.publish_at ? new Date(draft.publish_at) : null;

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:edit:image').setLabel('Image').setEmoji('🖼️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:edit:link').setLabel('Lien').setEmoji('🔗').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:edit:color').setLabel('Couleur').setEmoji('🎨').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:edit:mention').setLabel('Mention').setEmoji('🔔').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('panel:edit:field').setLabel('Champ').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('panel:edit:schedule').setLabel(scheduled ? 'Reprogrammer' : 'Programmer').setEmoji('⏰').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`panel:edit:${draft.kind}`).setLabel('Modifier le texte').setEmoji('✏️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('panel:publish:go')
        .setLabel(scheduled ? 'Confirmer la programmation' : 'Publier')
        .setEmoji('📤')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!targetId || problems.length > 0),
      new ButtonBuilder().setCustomId('panel:cancel:x').setLabel('Annuler').setStyle(ButtonStyle.Danger),
    ),
  ];

  const notes = [];
  if (!targetId) notes.push('⚠️ Salon cible introuvable. Relance `/setup` avant de publier.');
  for (const p of problems) notes.push(`⚠️ ${p}`);

  if (targetId && problems.length === 0) {
    notes.push(scheduled
      ? `⏰ Programmé dans <#${targetId}> pour <t:${Math.floor(scheduled.getTime() / 1000)}:F>`
      : `Aperçu — sera publié dans <#${targetId}>`);
  }

  const mentionLabel = { everyone: '@everyone', here: '@here' }[draft.mention]
    ?? (draft.mention ? `<@&${draft.mention}>` : 'aucune');
  notes.push(`🔔 Mention : **${mentionLabel}**`);

  // L'aperçu réutilise le moteur de rendu : ce qui est montré ici est
  // exactement ce qui partira, image en haut comprise.
  const preview = buildPublication(toPublication(draft), { components: [] });

  // Les notes ne peuvent pas aller dans `content` — interdit en V2 : elles
  // occupent leur propre conteneur, sous l'aperçu.
  const noteBox = new ContainerBuilder()
    .setAccentColor(COLORS.info)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(notes.join('\n')))
    .addActionRowComponents(rows[0])
    .addActionRowComponents(rows[1]);

  return {
    components: [...preview.components, noteBox],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
  };
}

/** Affiche l'aperçu en réponse à une interaction. */
async function showPreview(interaction, draft) {
  return interaction.reply(await buildPreview(interaction.guild, draft));
}

/** Réception du formulaire : on affiche un aperçu, on ne publie pas encore. */
export async function receiveComposer(interaction, typeId) {
  const type = PANEL_TYPES[typeId];
  if (!type) return;

  const previous = await getDraft(interaction.guild.id, interaction.user.id);

  const draft = await saveDraft(interaction.guild.id, interaction.user.id, {
    kind: typeId,
    title: interaction.fields.getTextInputValue('title').trim(),
    body: interaction.fields.getTextInputValue('body').trim(),
    imageUrl: interaction.fields.getTextInputValue('image')?.trim() || null,
    linkUrl: interaction.fields.getTextInputValue('link')?.trim() || null,
    // Conserve ce qui a été réglé par les boutons lors d'un aller-retour.
    color: previous?.kind === typeId ? previous.color ?? type.color : type.color,
    mention: previous?.kind === typeId ? previous.mention : type.defaultMention,
    linkLabel: previous?.link_label ?? null,
    fields: previous?.kind === typeId ? previous.fields : [],
  });

  return showPreview(interaction, draft);
}

/** Ouvre un mini-formulaire ou un menu selon le champ à régler. */
export async function openFieldEditor(interaction, field) {
  // « Modifier le texte » : on rouvre le formulaire principal.
  if (PANEL_TYPES[field]) return openComposer(interaction, field);

  const draft = await getDraft(interaction.guild.id, interaction.user.id);
  if (!draft) {
    return interaction.update({
      components: [], flags: MessageFlags.Ephemeral,
      content: '⏱️ Ce brouillon a expiré. Relance depuis le panneau.',
    });
  }

  if (field === 'color') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('panel:setcolor:x')
        .setPlaceholder('Couleur de la barre latérale')
        .addOptions(COLOR_CHOICES.map((c) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.label).setValue(c.value).setEmoji(c.emoji))),
    );
    return interaction.reply({
      content: '🎨 Choisis la couleur :', components: [row], flags: MessageFlags.Ephemeral,
    });
  }

  if (field === 'mention') {
    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('panel:setmention:x')
        .setPlaceholder('Qui notifier ?')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Personne').setValue('none').setEmoji('🔕'),
          new StringSelectMenuOptionBuilder().setLabel('@everyone').setValue('everyone').setEmoji('📣'),
          new StringSelectMenuOptionBuilder().setLabel('@here (connectés)').setValue('here').setEmoji('🔔'),
        ),
    );
    return interaction.reply({
      content: '🔔 Qui veux-tu notifier ?', components: [row], flags: MessageFlags.Ephemeral,
    });
  }

  // Les autres champs passent par un formulaire.
  const modal = new ModalBuilder().setCustomId(`panel:setfield:${field}`);

  if (field === 'image') {
    modal.setTitle('Image en haut');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('value').setLabel('Lien de l\'image (vide pour retirer)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)
        .setValue(draft.image_url ?? '').setPlaceholder('https://…'),
    ));
  } else if (field === 'link') {
    modal.setTitle('Bouton de lien');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('Lien (vide pour retirer)')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500)
          .setValue(draft.link_url ?? '').setPlaceholder('https://…'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('label').setLabel('Texte du bouton')
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80)
          .setValue(draft.link_label ?? '').setPlaceholder('En savoir plus'),
      ),
    );
  } else if (field === 'field') {
    modal.setTitle('Ajouter un champ');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('name').setLabel('Nom du champ')
          .setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100)
          .setPlaceholder('Lot, Règles, Serveur…'),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('value').setLabel('Contenu')
          .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400),
      ),
    );
  } else if (field === 'schedule') {
    modal.setTitle('Programmer la publication');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('value')
        .setLabel('Publier dans… (ex : 2h, 1d, vide = annuler)')
        .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(20)
        .setPlaceholder('2h'),
    ));
  } else {
    return;
  }

  return interaction.showModal(modal);
}

/** Applique la valeur saisie dans un mini-formulaire. */
export async function receiveFieldEditor(interaction, field) {
  const draft = await getDraft(interaction.guild.id, interaction.user.id);
  if (!draft) {
    return interaction.reply({
      content: '⏱️ Ce brouillon a expiré. Relance depuis le panneau.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const patch = {};

  if (field === 'image') {
    const value = interaction.fields.getTextInputValue('value')?.trim() || null;
    if (value && !isValidUrl(value)) {
      return interaction.reply({
        content: '❌ Le lien doit commencer par `http://` ou `https://`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    patch.image_url = value;
  }

  if (field === 'link') {
    const value = interaction.fields.getTextInputValue('value')?.trim() || null;
    if (value && !isValidUrl(value)) {
      return interaction.reply({
        content: '❌ Le lien doit commencer par `http://` ou `https://`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    patch.link_url = value;
    patch.link_label = interaction.fields.getTextInputValue('label')?.trim() || null;
  }

  if (field === 'field') {
    const fields = Array.isArray(draft.fields) ? [...draft.fields] : [];
    if (fields.length >= 10) {
      return interaction.reply({
        content: '❌ Pas plus de 10 champs. Retire-en un d\'abord (bouton **Modifier le texte**).',
        flags: MessageFlags.Ephemeral,
      });
    }
    fields.push({
      name: interaction.fields.getTextInputValue('name').trim(),
      value: interaction.fields.getTextInputValue('value').trim(),
    });
    patch.fields = JSON.stringify(fields);
  }

  if (field === 'schedule') {
    const raw = interaction.fields.getTextInputValue('value')?.trim();

    if (!raw) {
      patch.publish_at = null;
    } else {
      const ms = parseDuration(raw);
      if (ms === null) {
        return interaction.reply({
          content: '❌ Durée invalide. Utilise par exemple `30m`, `2h`, `1d` ou `1d6h`.',
          flags: MessageFlags.Ephemeral,
        });
      }
      patch.publish_at = new Date(Date.now() + ms);
    }
  }

  const updated = await patchDraft(draft.id, patch);
  return showPreview(interaction, updated ?? draft);
}

/** Applique un choix de menu (couleur, mention) et rafraîchit l'aperçu. */
export async function receiveSelectEditor(interaction, field) {
  const draft = await getDraft(interaction.guild.id, interaction.user.id);
  if (!draft) {
    return interaction.update({
      content: '⏱️ Ce brouillon a expiré.', components: [],
    });
  }

  const value = interaction.values[0];
  const patch = field === 'setcolor'
    ? { color: Number.parseInt(value, 10) }
    : { mention: value === 'none' ? null : value };

  const updated = await patchDraft(draft.id, patch);

  // Ce menu vit dans un message éphémère distinct de l'aperçu : on le
  // referme, puis on renvoie l'aperçu rafraîchi.
  await interaction.update({
    content: field === 'setcolor' ? '🎨 Couleur enregistrée.' : '🔔 Mention enregistrée.',
    components: [],
  });

  return interaction.followUp(await buildPreview(interaction.guild, updated ?? draft));
}

// ───────────────────────── Publication ─────────────────────────

/** Publication effective, ou mise en file si programmée. */
export async function publishDraft(interaction) {
  const draft = await getDraft(interaction.guild.id, interaction.user.id);

  if (!draft) {
    return interaction.update({
      components: [], flags: MessageFlags.Ephemeral,
    });
  }

  const type = PANEL_TYPES[draft.kind];
  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = draft.channel_id ?? channelIds[type?.channelKey];

  // Programmée : on mémorise la cible et on laisse le planificateur agir.
  if (draft.publish_at && new Date(draft.publish_at) > new Date()) {
    await patchDraft(draft.id, { channel_id: targetId });
    const ts = Math.floor(new Date(draft.publish_at).getTime() / 1000);

    return interaction.update({
      components: [], flags: MessageFlags.Ephemeral,
      content: `⏰ Publication programmée pour <t:${ts}:F> dans <#${targetId}>.`,
    });
  }

  try {
    const channel = await interaction.guild.channels.fetch(targetId);
    const message = await sendPublication(channel, toPublication(draft));

    await query(
      `UPDATE publications
          SET published = TRUE, message_id = $2, channel_id = $3
        WHERE id = $1`,
      [draft.id, message.id, channel.id],
    );

    return interaction.update({
      components: [], flags: MessageFlags.Ephemeral,
      content: `✅ Publié dans ${channel} !`,
    });
  } catch (err) {
    log.warn(`Publication impossible : ${err.message}`);
    return interaction.update({
      components: [], flags: MessageFlags.Ephemeral,
      content: `❌ Publication impossible : ${err.message}`,
    });
  }
}

/**
 * Réception du formulaire tournoi / giveaway : création immédiate.
 *
 * Passe par `lib/events.js`, exactement comme `/tournoi créer` et
 * `/giveaway lancer` — même rendu, mêmes colonnes écrites.
 */
export async function receiveEvent(interaction, kind) {
  const isTournament = kind === 'tournoi';

  const title = interaction.fields.getTextInputValue('title').trim();
  const when = interaction.fields.getTextInputValue('when').trim();
  const extraRaw = interaction.fields.getTextInputValue('extra')?.trim() || '';
  const limitRaw = interaction.fields.getTextInputValue('limit')?.trim() || '';
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

  try {
    if (isTournament) {
      // Format libre mais borné : une valeur inconnue retombe sur 5v5
      // plutôt que de créer un tournoi au format fantaisiste.
      const FORMATS = ['5v5', '2v2', '1v1', 'Event'];
      const format = FORMATS.find((f) => f.toLowerCase() === extraRaw.toLowerCase()) ?? '5v5';

      const maxTeams = limitRaw ? Number.parseInt(limitRaw, 10) : null;
      if (limitRaw && (Number.isNaN(maxTeams) || maxTeams < 2)) {
        return interaction.reply({
          content: '❌ Le nombre d\'équipes doit être un nombre supérieur ou égal à 2.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const { id } = await createTournament({
        guildId: interaction.guild.id,
        channel,
        name: title,
        description,
        format,
        maxTeams,
        startsAt: new Date(Date.now() + ms),
        createdBy: interaction.user.id,
      });

      return interaction.reply({
        content: `🏆 Tournoi **${title}** publié dans ${channel} (ID \`${id}\`, format ${format}).`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const winners = extraRaw ? Number.parseInt(extraRaw, 10) : 1;
    if (extraRaw && (Number.isNaN(winners) || winners < 1)) {
      return interaction.reply({
        content: '❌ Le nombre de gagnants doit être un nombre positif.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Le panneau perdait cette option : un giveaway Elite créé ici devenait
    // silencieusement ouvert à tous.
    const vipOnly = /^(oui|o|yes|y|true|1)$/i.test(limitRaw);

    const { id } = await createGiveaway({
      guildId: interaction.guild.id,
      channel,
      prize: title,
      winners,
      endsAt: new Date(Date.now() + ms),
      createdBy: interaction.user.id,
      vipOnly,
      conditions: description,
    });

    return interaction.reply({
      content:
        `🎁 Giveaway **${title}** lancé dans ${channel} (ID \`${id}\`)` +
        (vipOnly ? ' — **réservé aux Elite**.' : '.'),
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
export async function cancelDraft(interaction) {
  await query(
    `DELETE FROM publications
      WHERE guild_id = $1 AND created_by = $2 AND published = FALSE AND publish_at IS NULL`,
    [interaction.guild.id, interaction.user.id],
  );

  return interaction.update({
    components: [], flags: MessageFlags.Ephemeral,
    content: '🗑️ Brouillon abandonné.',
  });
}

/**
 * Planificateur des publications programmées.
 *
 * Même principe que les giveaways : la base fait foi, pas des minuteries en
 * mémoire qui ne survivraient pas à un redéploiement Railway.
 */
export function startPublicationScheduler(client, intervalMs = 30_000) {
  const tick = async () => {
    try {
      const { rows } = await query(
        `SELECT * FROM publications
          WHERE published = FALSE AND publish_at IS NOT NULL AND publish_at <= NOW()`,
      );

      for (const row of rows) {
        try {
          const channel = await client.channels.fetch(row.channel_id);
          const message = await sendPublication(channel, toPublication(row));

          await query(
            'UPDATE publications SET published = TRUE, message_id = $2 WHERE id = $1',
            [row.id, message.id],
          );

          log.info(`Publication programmée #${row.id} envoyée`);
        } catch (err) {
          // Marquée publiée malgré l'échec : sans cela, une cible supprimée
          // ferait boucler le planificateur toutes les 30 secondes.
          await query('UPDATE publications SET published = TRUE WHERE id = $1', [row.id]);
          log.warn(`Publication programmée #${row.id} abandonnée : ${err.message}`);
        }
      }
    } catch (err) {
      log.warn(`Planificateur de publications : ${err.message}`);
    }
  };

  setInterval(tick, intervalMs).unref();
  tick();
}
