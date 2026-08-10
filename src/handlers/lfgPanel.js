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
import { buildLfgMessage, toMessage } from '../lib/embeds.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';
import { log } from '../lib/logger.js';
import { PREMIER, FACEIT, rankByKey } from '../lib/ranks.js';
import { readMemberRanks } from './ranks.js';

/**
 * Recherche de mates au clic.
 *
 * Un bouton par mode, puis un formulaire court. Plus rien à taper, et les
 * options impossibles à se tromper.
 *
 * Après le formulaire, le membre choisit QUI notifier : personne, les
 * joueurs de son propre rang, ou un rang précis. C'est ce qui fait la
 * différence entre une annonce qui dort et une équipe qui se monte — mais
 * cela reste un choix explicite, jamais un ping automatique.
 */

/** Modes proposés — un bouton chacun (limite Discord : 5 par rangée). */
export const LFG_MODES = {
  premier: { id: 'premier', label: 'Premier', emoji: '🏆', name: 'Premier', style: ButtonStyle.Success },
  comp:    { id: 'comp',    label: 'Compétitif', emoji: '🎯', name: 'Compétitif 5v5', style: ButtonStyle.Primary },
  faceit:  { id: 'faceit',  label: 'Faceit', emoji: '⚡', name: 'Faceit', style: ButtonStyle.Danger },
  wingman: { id: 'wingman', label: 'Wingman', emoji: '👥', name: 'Wingman 2v2', style: ButtonStyle.Secondary },
  chill:   { id: 'chill',   label: 'Chill', emoji: '😎', name: 'Casual / Détente', style: ButtonStyle.Secondary },
};

/** Taille d'équipe par défaut, pré-remplie dans le formulaire. */
const DEFAULT_TEAM = { premier: 5, comp: 5, faceit: 5, wingman: 2, chill: 5 };

/**
 * Annonces en attente de leur choix de ping.
 *
 * Court terme par nature : entre la soumission du formulaire et le clic sur
 * le menu, quelques secondes. Un redémarrage les perd, ce qui est sans
 * conséquence — rien n'a encore été publié.
 */
const pending = new Map();
const pendingKey = (guildId, userId) => `${guildId}:${userId}`;

/** Panneau permanent publié dans #🎮-recherche-mates. */
export function buildLfgPanel() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle('🎮 Trouver des mates')
    .setDescription(
      'Clique sur le mode auquel tu veux jouer. Un petit formulaire ' +
      's\'ouvre, puis tu choisis qui prévenir.\n\n' +
      '> 🏆 **Premier** — matchmaking classé\n' +
      '> 🎯 **Compétitif** — 5v5 classique\n' +
      '> ⚡ **Faceit** — parties Faceit\n' +
      '> 👥 **Wingman** — 2v2\n' +
      '> 😎 **Chill** — détente, sans pression\n\n' +
      '🔔 Tu peux **notifier les joueurs de ton rang** pour trouver plus vite.\n' +
      'Les intéressés cliquent sur **Rejoindre** — tu reçois un message privé.',
    )
    .setFooter({ text: 'La taille de l\'équipe te compte : 5 = équipe de 5 au total.' });

  const row = new ActionRowBuilder().addComponents(
    Object.values(LFG_MODES).map((mode) =>
      new ButtonBuilder()
        .setCustomId(`lfgpanel:mode:${mode.id}`)
        .setLabel(mode.label)
        .setEmoji(mode.emoji)
        .setStyle(mode.style)),
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Ouvre le formulaire du mode choisi.
 * `showModal()` ne peut pas suivre un defer : on ne diffère jamais ici.
 */
export async function openLfgComposer(interaction, modeId) {
  const mode = LFG_MODES[modeId];
  if (!mode) return;

  const modal = new ModalBuilder()
    .setCustomId(`lfgpanel:submit:${modeId}`)
    .setTitle(`Recherche — ${mode.label}`.slice(0, 45));

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('team')
        .setLabel('Taille de l\'équipe (toi compris)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue(String(DEFAULT_TEAM[modeId] ?? 5)),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('rank')
        .setLabel('Rang recherché (facultatif)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(40)
        .setPlaceholder('10k-13k, Faceit 7-8, peu importe…'),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('note')
        .setLabel('Précisions (facultatif)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
        .setPlaceholder('Micro obligatoire, tryhard, une seule partie…'),
    ),
  );

  return interaction.showModal(modal);
}

/**
 * Réception du formulaire : on ne publie pas encore, on demande qui prévenir.
 *
 * Le menu ne propose que les rangs RÉELLEMENT créés sur le serveur : offrir
 * un choix qui ne pingerait personne serait une fausse promesse.
 */
export async function publishLfg(interaction, modeId) {
  const mode = LFG_MODES[modeId];
  if (!mode) return;

  const rawTeam = interaction.fields.getTextInputValue('team').trim();
  const rank = interaction.fields.getTextInputValue('rank')?.trim() || null;
  const note = interaction.fields.getTextInputValue('note')?.trim() || null;

  const slots = Number.parseInt(rawTeam, 10);

  // `slots` compte l'équipe entière : en dessous de 2, personne à chercher.
  if (Number.isNaN(slots) || slots < 2 || slots > 10) {
    return interaction.reply({
      content: '❌ La taille de l\'équipe doit être un nombre entre **2** et **10** (toi compris).',
      flags: MessageFlags.Ephemeral,
    });
  }

  const cfg = await getGuildConfig(interaction.guild.id);

  pending.set(pendingKey(interaction.guild.id, interaction.user.id), {
    modeId, slots, rank, note,
  });

  const rankRoles = parseJsonColumn(cfg.rank_roles);
  const mine = readMemberRanks(interaction.member, cfg);

  const options = [
    new StringSelectMenuOptionBuilder()
      .setLabel('Sans notification')
      .setValue('none')
      .setDescription('Publier l\'annonce sans prévenir personne')
      .setEmoji('🔕'),
  ];

  // « Mon rang » d'abord : c'est le cas le plus utile et le plus fréquent.
  const own = mine.premier ?? mine.faceit;
  if (own && rankRoles[own.key]) {
    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(`Les joueurs de mon rang — ${own.name}`)
      .setValue(`rank:${own.key}`)
      .setDescription('Notifie ceux qui ont le même rang que toi')
      .setEmoji(own.emoji));
  }

  // Puis chaque rang existant. Discord plafonne à 25 options par menu ; on
  // en a 11 au maximum plus les deux entrées fixes, la marge est confortable.
  for (const spec of [...PREMIER, ...FACEIT]) {
    if (!rankRoles[spec.key]) continue;
    if (own && spec.key === own.key) continue;

    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(spec.name)
      .setValue(`rank:${spec.key}`)
      .setEmoji(spec.emoji));
  }

  const row = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`lfgpanel:ping:${modeId}`)
      .setPlaceholder('Qui veux-tu prévenir ?')
      .addOptions(options.slice(0, 25)),
  );

  return interaction.reply({
    content:
      `🎮 **${mode.name}** · équipe de **${slots}**\n` +
      'Dernière étape : qui souhaites-tu notifier ?',
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

/** Choix du ping effectué : publication de l'annonce. */
export async function finishLfg(interaction, modeId) {
  const mode = LFG_MODES[modeId];
  const key = pendingKey(interaction.guild.id, interaction.user.id);
  const draft = pending.get(key);

  if (!mode || !draft) {
    return interaction.update({
      content: '⏱️ Cette recherche a expiré. Relance depuis le panneau.',
      components: [],
    });
  }

  const choice = interaction.values[0];
  const cfg = await getGuildConfig(interaction.guild.id);
  const channelIds = parseJsonColumn(cfg.channel_ids);
  const targetId = channelIds.lfg ?? cfg.lfg_channel_id ?? interaction.channel.id;

  const channel = await interaction.guild.channels.fetch(targetId).catch(() => null);

  if (!channel?.isTextBased()) {
    pending.delete(key);
    return interaction.update({
      content: '⚠️ Le salon de recherche est introuvable. Préviens un administrateur.',
      components: [],
    });
  }

  // Traduit le choix en identifiant de rôle à mentionner.
  let roleId = null;
  let roleLabel = null;

  if (choice.startsWith('rank:')) {
    const rankKey = choice.slice(5);
    const rankRoles = parseJsonColumn(cfg.rank_roles);
    roleId = rankRoles[rankKey] ?? null;
    roleLabel = rankByKey(rankKey)?.name ?? null;
  }

  try {
    const { rows } = await query(
      `INSERT INTO lfg_posts (guild_id, channel_id, user_id, mode, rank, slots, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        interaction.guild.id, channel.id, interaction.user.id,
        mode.name, draft.rank, draft.slots, draft.note,
      ],
    );
    const postId = rows[0].id;

    // La mention part dans un message distinct : un message Components V2 ne
    // peut pas porter de `content`, et une mention dans un bloc de texte ne
    // notifie pas de façon fiable.
    if (roleId) {
      await channel.send({
        content: `<@&${roleId}> — recherche de mates en **${mode.name}**`,
        // Restrictif à dessein : seul CE rôle est débloqué, rien d'autre.
        allowedMentions: { roles: [roleId] },
      }).catch(() => {
        // Mention refusée (rôle non mentionnable) : l'annonce compte plus.
      });
    }

    const message = await channel.send(
      toMessage(buildLfgMessage({
        id: postId,
        author: interaction.user,
        mode: mode.name,
        rank: draft.rank,
        slots: draft.slots,
        note: draft.note,
        joined: [],
        closed: false,
      })),
    );

    await query('UPDATE lfg_posts SET message_id = $2 WHERE id = $1', [postId, message.id]);
    pending.delete(key);

    return interaction.update({
      content:
        `✅ Ton annonce **${mode.label}** est publiée dans ${channel} !` +
        (roleLabel ? `\n🔔 Les joueurs **${roleLabel}** ont été prévenus.` : ''),
      components: [],
    });
  } catch (err) {
    pending.delete(key);
    log.warn(`Publication d'annonce impossible : ${err.message}`);
    return interaction.update({
      content: `❌ Publication impossible : ${err.message}`,
      components: [],
    });
  }
}
