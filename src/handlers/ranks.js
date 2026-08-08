import {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { COLORS } from '../lib/config.js';
import { log } from '../lib/logger.js';
import { RANK_SERIES, rankByKey } from '../lib/ranks.js';

/**
 * Rangs CS2 auto-attribuables.
 *
 * Deux menus indépendants (Premier, Faceit) : un membre peut porter un rang
 * de chaque série, mais un seul par série — choisir 6k-10k retire
 * automatiquement l'ancien rang Premier sans toucher au niveau Faceit.
 */

/** `rank_roles` peut arriver en objet (JSONB) ou en chaîne selon le driver. */
export function parseRankRoles(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return { ...value };
}

/**
 * Construit les menus déroulants, une rangée par série.
 *
 * Limites Discord respectées : 25 options par menu (on en a 7 et 4) et
 * 5 rangées par message (on en a 2).
 */
export function buildRankMenus(cfg) {
  const map = parseRankRoles(cfg?.rank_roles);
  const rows = [];

  for (const series of Object.values(RANK_SERIES)) {
    // On ne propose que les rangs dont le rôle est réellement résolu :
    // afficher une option qui échouerait à l'attribution est pire que de
    // ne pas l'afficher du tout.
    const options = series.ranks
      .filter((spec) => map[spec.key])
      .map((spec) => new StringSelectMenuOptionBuilder()
        .setLabel(spec.name)
        .setValue(spec.key)
        .setEmoji(spec.emoji));

    if (options.length === 0) continue;

    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(`Retirer mon ${series.label.toLowerCase()}`)
      .setValue(`clear-${series.id}`)
      .setEmoji('🚫'));

    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`ranks:set:${series.id}`)
        .setPlaceholder(series.placeholder)
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options),
    ));
  }

  return rows;
}

/** Panneau permanent publié dans #🎭-roles. */
export function buildRankPanel(cfg) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🎭 Choisis ton rang')
    .setDescription(
      'Sélectionne ta **cote Premier** et/ou ton **niveau Faceit** dans les ' +
      'menus ci-dessous.\n\n' +
      'Ton rang s\'affiche à côté de ton pseudo et aide les autres à te ' +
      'trouver pour jouer.\n\n' +
      '> 🔄 Tu peux en changer à tout moment — reviens ici après une montée.\n' +
      '> 🚫 Utilise « Retirer » pour ne plus afficher de rang.',
    )
    .setFooter({ text: 'Un seul rang par série. Choisir un nouveau rang remplace l\'ancien.' });

  return { embeds: [embed], components: buildRankMenus(cfg) };
}

/**
 * Applique le choix de rang.
 * La valeur sélectionnée arrive dans `interaction.values`, jamais dans le
 * customId — c'est la différence essentielle avec un bouton.
 */
export async function setRank(interaction, seriesId, cfg) {
  const value = interaction.values?.[0];
  if (!value) return;

  const series = RANK_SERIES[seriesId];
  if (!series) return;

  const map = parseRankRoles(cfg?.rank_roles);
  const member = interaction.member;

  // Tous les rôles de la série, pour retirer l'ancien rang.
  const seriesRoleIds = series.ranks
    .map((spec) => map[spec.key])
    .filter(Boolean);

  const isClear = value === `clear-${series.id}`;
  const targetId = isClear ? null : map[value];

  if (!isClear && !targetId) {
    return interaction.reply({
      content:
        '⚠️ Ce rang n\'est pas configuré sur le serveur. ' +
        'Demande à un administrateur de relancer `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    // Retire les autres rangs de la MÊME série uniquement : le rang de
    // l'autre série doit rester intact.
    const toRemove = seriesRoleIds.filter(
      (id) => id !== targetId && member.roles.cache.has(id),
    );
    if (toRemove.length > 0) {
      await member.roles.remove(toRemove, 'Changement de rang CS2');
    }

    if (isClear) {
      return interaction.reply({
        content: `🚫 Ton **${series.label.toLowerCase()}** a été retiré.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!member.roles.cache.has(targetId)) {
      await member.roles.add(targetId, 'Choix de rang CS2');
    }

    const rank = rankByKey(value);
    return interaction.reply({
      content: `${rank.emoji} Ton rang est maintenant **${rank.name}**. Bon jeu !`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.warn(`Attribution du rang impossible pour ${interaction.user.tag} : ${err.message}`);
    return interaction.reply({
      content:
        '❌ Je n\'ai pas pu modifier tes rôles.\n\n' +
        'Mon rôle doit être **au-dessus** des rôles de rang dans ' +
        '**Paramètres du serveur → Rôles**. Préviens un administrateur.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Lit les rangs actuels d'un membre — utilisé par /profil et /stats. */
export function readMemberRanks(member, cfg) {
  const map = parseRankRoles(cfg?.rank_roles);
  const result = {};

  for (const series of Object.values(RANK_SERIES)) {
    const spec = series.ranks.find(
      (r) => map[r.key] && member.roles.cache.has(map[r.key]),
    );
    result[series.id] = spec ?? null;
  }

  return result;
}
