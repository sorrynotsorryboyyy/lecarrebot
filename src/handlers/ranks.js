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
import { IDENTITY_GROUPS, identityByKey } from '../lib/identity.js';
import { parseJsonColumn } from '../lib/jsonColumn.js';

/**
 * Rangs CS2 auto-attribuables.
 *
 * Deux menus indépendants (Premier, Faceit) : un membre peut porter un rang
 * de chaque série, mais un seul par série — choisir 6k-10k retire
 * automatiquement l'ancien rang Premier sans toucher au niveau Faceit.
 */

/**
 * Conservé pour compatibilité : la lecture tolérante des colonnes JSONB
 * vit désormais dans lib/jsonColumn.js, partagée par tous les appelants.
 */
export const parseRankRoles = parseJsonColumn;

/**
 * Construit les menus déroulants, une rangée par série.
 *
 * Limites Discord respectées : 25 options par menu (on en a 7 et 4) et
 * 5 rangées par message (on en a 2).
 */
/**
 * Construit les rangées de menus pour un ensemble de groupes.
 *
 * Générique : sert aux rangs CS2 (`rank_roles`) comme aux rôles
 * d'identité (`identity_roles`). Discord plafonne à 5 rangées par
 * message, d'où deux panneaux distincts plutôt qu'un seul saturé.
 */
/**
 * Retire l'emoji de tête d'un libellé, s'il correspond à celui du rôle.
 * Comparaison exacte : une expression générique amputerait « Faceit 1-3 »
 * de son premier mot.
 */
function stripLeadingEmoji(name, emoji) {
  if (!emoji || !name.startsWith(emoji)) return name;
  return name.slice(emoji.length).trim() || name;
}

export function buildSelectRows(groups, roleMap, domain) {
  const rows = [];

  for (const group of Object.values(groups)) {
    // On ne propose que les options dont le rôle est réellement résolu :
    // afficher un choix qui échouerait à l'attribution est pire que de ne
    // pas l'afficher du tout.
    const options = group.ranks
      .filter((spec) => roleMap[spec.key])
      .map((spec) => new StringSelectMenuOptionBuilder()
        // Le nom du rôle porte déjà son emoji : Discord l'affichant à
        // part, on le retire du libellé pour éviter le doublon. On ne
        // retire QUE l'emoji lui-même — « Faceit 1-3 » doit rester intact.
        .setLabel(stripLeadingEmoji(spec.name, spec.emoji))
        .setValue(spec.key)
        .setEmoji(spec.emoji));

    if (options.length === 0) continue;

    options.push(new StringSelectMenuOptionBuilder()
      .setLabel(`Retirer — ${group.label}`)
      .setValue(`clear-${group.id}`)
      .setEmoji('🚫'));

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`${domain}:set:${group.id}`)
      .setPlaceholder(group.placeholder)
      .setMinValues(1)
      // Multi-sélection pour les groupes non exclusifs (style de jeu).
      // L'option « Retirer » occupe un cran, d'où le -1.
      .setMaxValues(group.multi ? Math.max(1, options.length - 1) : 1)
      .addOptions(options);

    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  return rows;
}

/** Menus des rangs CS2 (Premier + Faceit). */
export function buildRankMenus(cfg) {
  return buildSelectRows(RANK_SERIES, parseRankRoles(cfg?.rank_roles), 'ranks');
}

/** Menus des rôles d'identité (âge, genre, style de jeu). */
export function buildIdentityMenus(cfg) {
  return buildSelectRows(IDENTITY_GROUPS, parseRankRoles(cfg?.identity_roles), 'identity');
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
export async function setRank(interaction, groupId, cfg, domain = 'ranks') {
  const values = interaction.values ?? [];
  if (values.length === 0) return;

  const isIdentity = domain === 'identity';
  const groups = isIdentity ? IDENTITY_GROUPS : RANK_SERIES;
  const group = groups[groupId];
  if (!group) return;

  const map = parseRankRoles(isIdentity ? cfg?.identity_roles : cfg?.rank_roles);
  const member = interaction.member;

  // Tous les rôles du groupe, pour retirer les anciens choix.
  const groupRoleIds = group.ranks.map((spec) => map[spec.key]).filter(Boolean);

  const isClear = values.includes(`clear-${group.id}`);
  const chosen = values.filter((v) => v !== `clear-${group.id}`);
  const targetIds = chosen.map((v) => map[v]).filter(Boolean);

  if (!isClear && targetIds.length === 0) {
    return interaction.reply({
      content:
        '⚠️ Ce rôle n\'est pas configuré sur le serveur. ' +
        'Demande à un administrateur de relancer `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    // Retire les autres rôles du MÊME groupe : les autres groupes (rang de
    // l'autre série, genre, style…) restent intacts.
    const toRemove = groupRoleIds.filter(
      (id) => !targetIds.includes(id) && member.roles.cache.has(id),
    );
    if (toRemove.length > 0) {
      await member.roles.remove(toRemove, `Changement — ${group.label}`);
    }

    if (isClear && targetIds.length === 0) {
      return interaction.reply({
        content: `🚫 **${group.label}** retiré.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const toAdd = targetIds.filter((id) => !member.roles.cache.has(id));
    if (toAdd.length > 0) {
      await member.roles.add(toAdd, `Choix — ${group.label}`);
    }

    // rankByKey peut renvoyer null si une clé du groupe n'existe pas dans
    // les tables : on ne déréférence jamais sans contrôle.
    const labels = chosen
      .map((v) => (isIdentity ? identityByKey(v) : rankByKey(v)))
      .filter(Boolean)
      .map((spec) => `${spec.emoji} **${spec.name}**`);

    return interaction.reply({
      content: labels.length > 0
        ? `✅ ${group.label} : ${labels.join(', ')}`
        : '✅ Tes rôles ont été mis à jour.',
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    log.warn(`Attribution de rôle impossible pour ${interaction.user.tag} : ${err.message}`);
    return interaction.reply({
      content:
        '❌ Je n\'ai pas pu modifier tes rôles.\n\n' +
        'Mon rôle doit être **au-dessus** des rôles concernés dans ' +
        '**Paramètres du serveur → Rôles**. Préviens un administrateur.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

/** Panneau permanent « À propos de toi » (âge, genre, style de jeu). */
export function buildIdentityPanel(cfg) {
  // On liste nommément chaque rôle disponible : un menu seul n'indique pas
  // ce qu'il contient tant qu'on ne l'a pas ouvert.
  const list = (group) => group.ranks
    .map((spec) => `${spec.emoji} **${spec.name.replace(/^\S+\s/, '')}**`)
    .join(' · ');

  const embed = new EmbedBuilder()
    .setColor(COLORS.info)
    .setTitle('🧩 À propos de toi')
    .setDescription(
      'Ces rôles aident la communauté à mieux te connaître et à former des ' +
      'équipes qui te correspondent.\n\n' +
      'Rien n\'est obligatoire — choisis seulement ce que tu veux afficher.',
    )
    .addFields(
      {
        name: '🔞 Tranche d\'âge',
        value: `${list(IDENTITY_GROUPS.age)}\n*Pour les salons et événements adaptés.*`,
      },
      {
        name: '⚧️ Genre',
        value: `${list(IDENTITY_GROUPS.gender)}\n*Entièrement facultatif.*`,
      },
      {
        name: '🎮 Style de jeu',
        value: `${list(IDENTITY_GROUPS.playstyle)}\n*Tu peux choisir les deux !*`,
      },
    )
    .setFooter({ text: 'Un seul choix par catégorie (sauf style de jeu) · Modifiable à tout moment' });

  return { embeds: [embed], components: buildIdentityMenus(cfg) };
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

/** Lit les rôles d'identité d'un membre. Le style de jeu peut être multiple. */
export function readMemberIdentity(member, cfg) {
  const map = parseRankRoles(cfg?.identity_roles);
  const result = {};

  for (const group of Object.values(IDENTITY_GROUPS)) {
    const found = group.ranks.filter(
      (r) => map[r.key] && member.roles.cache.has(map[r.key]),
    );
    result[group.id] = group.multi ? found : (found[0] ?? null);
  }

  return result;
}
