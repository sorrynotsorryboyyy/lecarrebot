import {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { log } from '../../lib/logger.js';
import { buildVerifyPanel } from '../../handlers/verification.js';
import {
  CATEGORIES,
  CHANNEL_CONFIG_KEYS,
  CHANNEL_INTROS,
  PROTECTED_ROLES,
  RETIRED_CATEGORY_KEYS,
  RETIRED_CHANNEL_KEYS,
  ROLES,
  buildOverwrites,
  channelType,
  permName,
} from '../../lib/blueprint.js';
import {
  ALL_RANKS, FACEIT, PREMIER,
  normalizeRankName, rankByKey, rankKeyForRoleName,
} from '../../lib/ranks.js';
import { ALL_IDENTITY, identityByKey, identityKeyForRoleName } from '../../lib/identity.js';
import { buildIdentityPanel, buildRankPanel } from '../../handlers/ranks.js';
import { buildLfgPanel } from '../../handlers/lfgPanel.js';
import { buildPanelMenu } from '../../handlers/panel.js';
import { buildTicketPanel } from '../../handlers/tickets.js';
import { parseJsonColumn } from '../../lib/jsonColumn.js';

/**
 * /setup — construit l'intégralité du serveur en une seule commande.
 *
 * Idempotent : réutilise ce qui existe déjà (par ID mémorisé, puis par nom)
 * au lieu de créer des doublons. On peut donc la relancer sans risque après
 * avoir supprimé un salon par erreur.
 */
export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Crée TOUT le serveur : rôles, catégories, salons, permissions et panneau')
  .addBooleanOption((o) =>
    o.setName('verrouiller_existant')
      .setDescription('Masquer aussi les salons déjà présents aux non-vérifiés (défaut : oui)'))
  .addBooleanOption((o) =>
    o.setName('garder_anciens')
      .setDescription('Conserver les salons retirés du plan au lieu de les supprimer'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // La création complète dépasse largement les 3s d'une réponse directe.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const me = guild.members.me;
  const lockExisting = interaction.options.getBoolean('verrouiller_existant') ?? true;
  const removeOld = !(interaction.options.getBoolean('garder_anciens') ?? false);

  if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
    const missing = ['ManageRoles', 'ManageChannels']
      .filter((p) => !me.permissions.has(PermissionFlagsBits[p]));
    if (missing.length > 0) {
      return interaction.editReply(
        '❌ Permissions insuffisantes.\n\n' +
        'Il me faut au minimum **Gérer les rôles** et **Gérer les salons** ' +
        '(le plus simple : donne-moi **Administrateur**).',
      );
    }
  }

  const report = {
    roles: [], ranks: [], identity: [], categories: [], channels: [],
    locked: 0, repaired: 0, ghosts: [], renamed: [], removed: [], warnings: [],
  };
  const patch = {};

  try {
    // ─── 0. Réchauffement du cache ───────────────────────────────
    // Sans ces fetch, le cache peut être partiel et /setup prendrait des
    // salons parfaitement vivants pour des fantômes — puis les recréerait
    // en double. Toutes les recherches par nom ci-dessous en dépendent.
    await guild.channels.fetch();
    await guild.roles.fetch();

    const cfg = await getGuildConfig(guild.id);

    // ─── 1. Diagnostic des références obsolètes ──────────────────
    // On efface les IDs morts AVANT la résolution : un salon renommé sera
    // alors retrouvé par son nom au lieu d'être recréé en double.
    const ghosts = diagnose(guild, cfg);
    applyGhostCleanup(ghosts, cfg, patch, report);

    // ─── 2. Rôles structurels ────────────────────────────────────
    const roleIds = await ensureRoles(guild, cfg, report);
    patch.verified_role_id = roleIds.verified;

    // La suite dépend du rôle membre : sans lui, rien n'a de sens.
    if (!roleIds.verified) {
      return interaction.editReply(
        '❌ Impossible de créer ou retrouver le rôle membre. Vérifie mes permissions.',
      );
    }

    // ─── 3. Rangs CS2 et rôles d'identité : adoption sans doublon ─
    const rankRoles = await ensureRankRoles(guild, cfg, roleIds, report);
    patch.rank_roles = JSON.stringify(rankRoles);

    const identityRoles = await ensureIdentityRoles(guild, cfg, roleIds, report);
    patch.identity_roles = JSON.stringify(identityRoles);

    if (roleIds.vip) patch.vip_role_id = roleIds.vip;
    if (roleIds.losange) patch.losange_role_id = roleIds.losange;

    // Une fois les deux familles résolues, on range tout d'un bloc :
    // rangs au-dessus de Membre (ils colorent le pseudo), identité en
    // dessous. Purement cosmétique — un échec n'interrompt pas /setup.
    await reorderAllRoles(guild, roleIds, rankRoles, identityRoles, report);

    const ids = {
      everyone: guild.roles.everyone.id,
      verified: roleIds.verified,
      moderator: roleIds.moderator,
      admin: roleIds.admin,
      bot: me.id,
      // Le VIP voit tout ce que voient les membres.
      protectedRoles: [...findProtectedRoles(guild, report), roleIds.vip].filter(Boolean),
      // Le même rôle, exposé à part pour les salons `access: 'elite'`. Le
      // garder aussi dans `protectedRoles` préserve l'accès aux salons
      // membres, qui ne dépend pas de ce champ.
      elite: roleIds.vip,
      // Losange Vérifié : n'ouvre QUE sa propre catégorie. Volontairement
      // absent de `protectedRoles` — un Losange accède aux salons membres
      // par son rôle Membre, pas par celui-ci.
      losange: roleIds.losange,
    };

    // ─── 4. Catégories et salons ─────────────────────────────────
    const created = await ensureStructure(guild, cfg, ids, report);

    // Carte complète cléSalon → identifiant : c'est elle qui rend les
    // renommages possibles sans créer de doublon à la prochaine passe.
    patch.channel_ids = JSON.stringify(created);

    for (const [key, column] of Object.entries(CHANNEL_CONFIG_KEYS)) {
      if (created[key]) patch[column] = created[key];
    }

    // ─── 5. Salons retirés du plan ───────────────────────────────
    await removeRetiredChannels(guild, cfg, report, removeOld);

    // ─── 6. Salons préexistants ──────────────────────────────────
    // Sans cette étape, la vérification serait décorative : un arrivant
    // verrait déjà tout ce qui existait avant le setup.
    if (lockExisting) {
      report.locked = await lockLegacyChannels(guild, ids, created, report);
    }

    await updateGuildConfig(guild.id, patch);

    // ─── 7. Contenus : règlement, panneaux, présentations ────────
    const freshCfg = await getGuildConfig(guild.id);
    await publishPanel(guild, created, report);
    await publishRankPanel(guild, created, freshCfg, report);
    await publishStaticPanels(guild, created, freshCfg, report);
    await publishIntros(guild, created, report);

    // ─── 8. Hiérarchie ───────────────────────────────────────────
    checkHierarchy(guild, me, roleIds, report);
  } catch (err) {
    log.error('Échec du setup', err);
    return interaction.editReply(
      `❌ Le setup s'est interrompu : ${err.message}\n\n` +
      'Les éléments déjà créés sont conservés — relance `/setup` pour reprendre.',
    );
  }

  // Trace complète côté serveur : l'embed tronque à 5 avertissements et
  // 1024 caractères, les logs Railway gardent tout.
  log.info(
    `/setup sur ${guild.name} — `
    + `${report.ranks.length} rang(s), ${report.identity.length} rôle(s) d'identité, `
    + `${report.channels.length} salon(s), ${report.warnings.length} avertissement(s)`,
  );
  if (report.identity.length > 0) {
    log.info(`Identité : ${report.identity.map((x) => `${x.name} (${x.status})`).join(', ')}`);
  }
  for (const w of report.warnings) log.warn(`  ⚠ ${w.replace(/\*\*/g, '')}`);

  return interaction.editReply({ embeds: [buildReport(report)] });
}

/**
 * Inventorie l'écart entre la configuration enregistrée et la réalité du
 * serveur. Aucune écriture : cette passe ne fait que constater.
 *
 * Un « fantôme » est un ID mémorisé en base dont l'objet n'existe plus.
 * Le cas le plus dangereux est `verified_role_id` : laissé en place, il
 * ferait échouer chaque vérification (`roles.add` sur un ID mort).
 */
function diagnose(guild, cfg) {
  const ghosts = { channels: [], roles: [], ranks: [], identity: [] };

  for (const [key, column] of Object.entries(CHANNEL_CONFIG_KEYS)) {
    const id = cfg[column];
    if (id && !guild.channels.cache.has(id)) {
      ghosts.channels.push({ key, column, id });
    }
  }

  for (const column of ['verified_role_id', 'unverified_role_id', 'vip_role_id', 'losange_role_id']) {
    const id = cfg[column];
    if (id && !guild.roles.cache.has(id)) {
      ghosts.roles.push({ column, id });
    }
  }

  const rankMap = parseJsonColumn(cfg.rank_roles);
  for (const [key, id] of Object.entries(rankMap)) {
    if (!guild.roles.cache.has(id)) ghosts.ranks.push({ key, id });
  }

  // Même contrôle pour l'identité : un rôle supprimé à la main laisse son
  // identifiant en base. `ensureIdentityRoles` le retrouverait dans la
  // carte mémorisée, échouerait à le résoudre, et l'option disparaîtrait
  // du menu sans la moindre erreur.
  const identityMap = parseJsonColumn(cfg.identity_roles);
  for (const [key, id] of Object.entries(identityMap)) {
    if (!guild.roles.cache.has(id)) ghosts.identity.push({ key, id });
  }

  return ghosts;
}

/**
 * Efface les références mortes pour que la résolution par nom reprenne la
 * main. On ne recrée jamais directement depuis le diagnostic : un salon
 * peut avoir été simplement renommé, auquel cas il sera retrouvé.
 */
function applyGhostCleanup(ghosts, cfg, patch, report) {
  for (const { key, column } of ghosts.channels) {
    cfg[column] = null;
    patch[column] = null;
    report.ghosts.push(`Salon **${key}** (supprimé) — référence nettoyée`);
  }

  const ROLE_LABELS = {
    verified_role_id: 'membre',
    unverified_role_id: 'non-vérifié',
    vip_role_id: 'Elite',
    losange_role_id: 'Losange Vérifié',
  };

  for (const { column } of ghosts.roles) {
    cfg[column] = null;
    patch[column] = null;
    report.ghosts.push(
      `Rôle **${ROLE_LABELS[column] ?? column}** (supprimé) — référence nettoyée`,
    );
  }

  if (ghosts.ranks.length > 0) {
    const map = parseJsonColumn(cfg.rank_roles);
    for (const { key } of ghosts.ranks) {
      delete map[key];
      const rank = rankByKey(key);
      report.ghosts.push(`Rang **${rank?.name ?? key}** (supprimé) — référence nettoyée`);
    }
    cfg.rank_roles = map;
  }

  // Sans ce nettoyage, un rôle d'identité supprimé à la main resterait
  // référencé et ne serait jamais recréé : l'option disparaîtrait du menu
  // définitivement.
  if (ghosts.identity.length > 0) {
    const map = parseJsonColumn(cfg.identity_roles);
    for (const { key } of ghosts.identity) {
      delete map[key];
      const spec = identityByKey(key);
      report.ghosts.push(`Rôle **${spec?.name ?? key}** (supprimé) — référence nettoyée`);
    }
    cfg.identity_roles = map;
  }
}

/**
 * Détecte les rôles vous appartenant (Fondateur, Amis) pour leur ouvrir les
 * salons membres. Ils ne sont ni créés, ni renommés, ni modifiés.
 */
function findProtectedRoles(guild, report) {
  const found = [];

  for (const spec of PROTECTED_ROLES) {
    const wanted = spec.names.map((n) => normalizeRankName(n));
    const role = guild.roles.cache.find(
      (r) => !r.managed && wanted.includes(normalizeRankName(r.name)),
    );
    if (role) {
      found.push(role.id);
      report.roles.push({ name: role.name, status: 'protégé' });
    }
  }

  return found;
}

/**
 * Réconcilie les rangs CS2 avec les rôles déjà présents sur le serveur.
 *
 * Trois passes :
 *   1. résolution sans création (ID mémorisé, puis nom normalisé) ;
 *   2. création de ce qui manque réellement ;
 *   3. repositionnement sous le rôle membre.
 *
 * La passe 3 est indispensable : `guild.roles.create` place chaque nouveau
 * rôle au sommet de la portée du bot, ce qui placerait les rangs au-dessus
 * d'Admin sans ce correctif.
 */
async function ensureRankRoles(guild, cfg, roleIds, report) {
  const stored = parseJsonColumn(cfg.rank_roles);
  const resolved = {};
  const claimed = new Set();
  const missing = [];

  // ─── Passe 1 : résolution ──────────────────────────────────────
  for (const spec of ALL_RANKS) {
    const knownId = stored[spec.key];
    let role = knownId ? guild.roles.cache.get(knownId) : null;

    if (role && !claimed.has(role.id)) {
      resolved[spec.key] = role.id;
      claimed.add(role.id);
      report.ranks.push({ name: role.name, status: 'existant' });
      continue;
    }

    // Correspondance tolérante : '3K-6K', '6K - 10K', '🔫 20K +' …
    role = guild.roles.cache.find(
      (r) => !r.managed
        && r.id !== guild.roles.everyone.id
        && !claimed.has(r.id)
        && rankKeyForRoleName(r.name) === spec.key,
    );

    if (role) {
      resolved[spec.key] = role.id;
      claimed.add(role.id);
      report.ranks.push({ name: role.name, status: 'adopté' });
      continue;
    }

    missing.push(spec);
  }

  // ─── Passe 2 : création ────────────────────────────────────────
  // Ordre inversé : chaque création se plaçant au sommet, créer du plus
  // haut rang au plus bas laisse finalement le plus haut… en haut.
  for (const spec of [...missing].reverse()) {
    try {
      const role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'CarréBot — rangs CS2',
      });
      resolved[spec.key] = role.id;
      report.ranks.push({ name: spec.name, status: 'créé' });
    } catch (err) {
      report.warnings.push(`Rang **${spec.name}** non créé : ${err.message}`);
    }
  }

  // Même logique que pour l'identité : un rang non résolu disparaît du
  // menu sans explication.
  const unresolved = ALL_RANKS.filter((spec) => !resolved[spec.key]);
  if (unresolved.length > 0) {
    report.warnings.push(
      `${unresolved.length} rang(s) non résolu(s) : ` +
      unresolved.map((s) => `**${s.name}**`).join(', ') +
      '. Ils n\'apparaîtront pas dans le menu.',
    );
  }

  // Le repositionnement a lieu plus tard, dans reorderAllRoles() : il doit
  // connaître les rangs ET les rôles d'identité pour les ranger d'un bloc.
  return resolved;
}

/**
 * Redescend les rangs juste sous le rôle membre, en un seul appel API.
 * Purement cosmétique : un échec ne doit jamais interrompre /setup.
 */
async function reorderAllRoles(guild, roleIds, rankRoles, identityRoles, report) {
  try {
    const member = guild.roles.cache.get(roleIds.verified);
    if (!member) return;

    // Discord applique la couleur du rôle coloré le PLUS HAUT. En plaçant
    // les rangs au-dessus du rôle Membre et l'identité en dessous, la
    // couleur du pseudo vient toujours de la cote Premier.
    //
    // Ordre voulu, du plus haut au plus bas :
    //   … staff … > rangs CS2 > 🎮 Membre > identité > @everyone
    // Faceit d'abord, Premier ensuite : Premier se retrouve donc PLUS HAUT
    // et c'est sa couleur qui colore le pseudo, comme voulu. À l'intérieur
    // de chaque série, l'ordre du tableau va du plus bas au plus haut — on
    // ne l'inverse pas, sinon un 1k-3k dominerait un 20k+.
    const ranked = [...FACEIT, ...PREMIER]
      .map((s) => rankRoles[s.key])
      .filter(Boolean);
    const identity = ALL_IDENTITY.map((s) => identityRoles[s.key]).filter(Boolean);

    // On empile depuis le bas : position 1 = juste au-dessus de @everyone.
    // Identité, puis Membre, puis les rangs par ordre croissant de cote.
    // Les rôles de staff, plus hauts, ne sont pas touchés.
    const ordered = [...identity, member.id, ...ranked];

    const positions = ordered.map((id, i) => ({ role: id, position: i + 1 }));

    // Le staff doit rester au-dessus de tout ce bloc : si la pile dépasse
    // la position du rôle le plus bas du staff, on renonce plutôt que de
    // bousculer la hiérarchie du serveur.
    const staffFloor = [roleIds.admin, roleIds.moderator, roleIds.vip, roleIds.losange]
      .map((id) => guild.roles.cache.get(id)?.position)
      .filter((p) => p != null);

    if (staffFloor.length > 0 && positions.length + 1 > Math.min(...staffFloor)) {
      report.warnings.push(
        'Rôles non réordonnés : pas assez de place sous les rôles du staff. ' +
        'Remonte le rôle du bot et relance `/setup`.',
      );
      return;
    }

    await guild.roles.setPositions(positions);
  } catch (err) {
    report.warnings.push(`Réordonnancement des rôles impossible : ${err.message}`);
  }
}

/**
 * Réconcilie les rôles d'identité (âge, genre, style de jeu).
 * Même principe que les rangs : on adopte l'existant, on ne duplique pas.
 */
async function ensureIdentityRoles(guild, cfg, roleIds, report) {
  const stored = parseJsonColumn(cfg.identity_roles);
  const resolved = {};
  const claimed = new Set();
  const missing = [];

  for (const spec of ALL_IDENTITY) {
    let role = stored[spec.key] ? guild.roles.cache.get(stored[spec.key]) : null;

    if (role && !claimed.has(role.id)) {
      resolved[spec.key] = role.id;
      claimed.add(role.id);
      report.identity.push({ name: role.name, status: 'existant' });
      continue;
    }

    role = guild.roles.cache.find(
      (r) => !r.managed
        && r.id !== guild.roles.everyone.id
        && !claimed.has(r.id)
        && identityKeyForRoleName(r.name) === spec.key,
    );

    if (role) {
      resolved[spec.key] = role.id;
      claimed.add(role.id);
      report.identity.push({ name: role.name, status: 'adopté' });
      continue;
    }

    missing.push(spec);
  }

  for (const spec of [...missing].reverse()) {
    try {
      const role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        hoist: false,
        mentionable: false,
        permissions: [],
        reason: 'CarréBot — rôles d\'identité',
      });
      resolved[spec.key] = role.id;
      report.identity.push({ name: spec.name, status: 'créé' });
    } catch (err) {
      report.warnings.push(`Rôle **${spec.name}** non créé : ${err.message}`);
    }
  }

  // Un rôle non résolu disparaît silencieusement du menu : on nomme
  // explicitement les manquants, sinon l'admin voit un panneau incomplet
  // sans savoir lesquels manquent ni pourquoi.
  const unresolved = ALL_IDENTITY.filter((spec) => !resolved[spec.key]);
  if (unresolved.length > 0) {
    report.warnings.push(
      `${unresolved.length} rôle(s) d'identité non résolu(s) : ` +
      unresolved.map((s) => `**${s.name}**`).join(', ') +
      '. Ils n\'apparaîtront pas dans le menu.',
    );
  }

  return resolved;
}

/**
 * Publie les panneaux fixes : identité, recherche de mates, publication.
 * Chacun se dédoublonne sur le customId de son premier composant, pour
 * que /setup reste relançable sans empiler les messages.
 */
async function publishStaticPanels(guild, created, cfg, report) {
  // Le panneau de gestion vocale n'est PAS publié ici : il est posté dans
  // le chat du salon vocal à sa création, seul endroit où il s'adresse à
  // quelqu'un qui a effectivement un salon à gérer.
  const panels = [
    { key: 'roles', prefix: 'identity:', build: () => buildIdentityPanel(cfg) },
    { key: 'lfg', prefix: 'lfgpanel:', build: () => buildLfgPanel() },
    // Panneau de publication, dans le salon staff : il ne se perd plus dans
    // l'historique et toute l'équipe y accède au même endroit.
    { key: 'staff-panel', prefix: 'panel:', build: () => buildPanelMenu() },
    { key: 'support', prefix: 'ticket:', build: () => buildTicketPanel() },
  ];

  for (const panel of panels) {
    const channelId = created[panel.key];
    if (!channelId) continue;

    try {
      const channel = await guild.channels.fetch(channelId);

      const payload = panel.build();

      // Un panneau sans composant signale que les rôles n'ont pas été
      // résolus : on le dit plutôt que de sauter en silence, sinon
      // l'admin ne comprend pas pourquoi rien n'apparaît.
      if (!payload || payload.components?.length === 0) {
        report.warnings.push(
          `Panneau **${panel.key}** (${panel.prefix}) vide : aucun rôle résolu. ` +
          'Vérifie que le bot peut voir et gérer ces rôles.',
        );
        log.warn(`Panneau « ${panel.prefix} » vide — aucun composant construit`);
        continue;
      }

      await republishPanel(channel, panel.prefix, payload);
    } catch (err) {
      report.warnings.push(`Panneau **${panel.key}** non publié : ${err.message}`);
      log.error(`Panneau « ${panel.prefix} » non publié`, err);
    }
  }
}

/** Crée les rôles manquants et renvoie leurs IDs par clé. */
async function ensureRoles(guild, cfg, report) {
  const ids = {};

  // Créés du plus bas au plus haut : chaque `create` place le rôle en haut
  // de ce que le bot peut atteindre, donc l'ordre inverse donne la bonne
  // hiérarchie finale (Admin > Modérateur > Vérifié).
  // Colonnes mémorisant l'identifiant d'un rôle structurel. Les relire en
  // priorité permet de retrouver un rôle RENOMMÉ à la main, que la
  // correspondance par nom manquerait.
  const KNOWN_COLUMNS = {
    verified: 'verified_role_id',
    vip: 'vip_role_id',
    losange: 'losange_role_id',
  };

  for (const spec of [...ROLES].reverse()) {
    const column = KNOWN_COLUMNS[spec.key];
    const knownId = column ? cfg[column] : null;

    let role = knownId ? guild.roles.cache.get(knownId) : null;

    // Correspondance tolérante (casse, emoji, espaces) et sur les anciens
    // noms : un rôle « Admin » ou « ✅ Vérifié » déjà présent est adopté
    // plutôt que dupliqué.
    if (!role) {
      const wanted = [spec.name, ...(spec.aliases ?? [])].map((n) => normalizeRankName(n));
      role = guild.roles.cache.find(
        (r) => !r.managed && wanted.includes(normalizeRankName(r.name)),
      );
    }

    if (role) {
      ids[spec.key] = role.id;

      // Le rôle d'accès a été renommé « 🎮 Membre » : on renomme sur place
      // pour préserver les attributions existantes — recréer un rôle ferait
      // perdre leur accès à tous les membres déjà vérifiés.
      if (role.name !== spec.name && role.editable) {
        try {
          await role.setName(spec.name, 'CarréBot — harmonisation du nom');
          report.roles.push({ name: `${spec.name} (renommé)`, status: 'existant' });
          continue;
        } catch {
          // Renommage refusé : le rôle reste utilisable tel quel.
        }
      }

      report.roles.push({ name: role.name, status: 'existant' });
      continue;
    }

    try {
      role = await guild.roles.create({
        name: spec.name,
        color: spec.color,
        hoist: spec.hoist,
        permissions: spec.permissions,
        reason: 'CarréBot — setup',
      });
      ids[spec.key] = role.id;
      report.roles.push({ name: spec.name, status: 'créé' });
    } catch (err) {
      report.warnings.push(`Rôle **${spec.name}** non créé : ${err.message}`);
    }
  }

  return ids;
}

/** Crée catégories et salons manquants. Renvoie { cléSalon: id }. */
async function ensureStructure(guild, cfg, ids, report) {
  const created = {};

  // Carte cléSalon → identifiant, mémorisée d'une exécution à l'autre.
  // C'est elle qui permet de RENOMMER un salon sans en créer un double.
  const known = parseJsonColumn(cfg.channel_ids);

  for (const cat of CATEGORIES) {
    const catKey = `cat:${cat.key}`;
    let category = known[catKey]
      ? guild.channels.cache.get(known[catKey])
      : null;

    if (!category) {
      category = guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === cat.name,
      );
    }

    if (!category) {
      try {
        category = await guild.channels.create({
          name: cat.name,
          type: ChannelType.GuildCategory,
          permissionOverwrites: buildOverwrites(cat.access, ids),
          reason: 'CarréBot — setup',
        });
        report.categories.push({ name: cat.name, status: 'créée' });
      } catch (err) {
        report.warnings.push(`Catégorie **${cat.name}** non créée : ${err.message}`);
        continue;
      }
    } else {
      // Retrouvée par identifiant mais renommée entre-temps : on aligne
      // le nom au lieu d'abandonner une catégorie orpheline.
      if (category.name !== cat.name) {
        await category.setName(cat.name, 'CarréBot — mise à jour du plan').catch(() => {});
        report.categories.push({ name: cat.name, status: 'existante' });
      } else {
        report.categories.push({ name: cat.name, status: 'existante' });
      }
    }

    created[catKey] = category.id;

    for (const spec of cat.channels) {
      // Priorité à l'identifiant mémorisé : immunise contre les renommages.
      const configColumn = CHANNEL_CONFIG_KEYS[spec.key];
      const knownId = known[spec.key] ?? (configColumn ? cfg[configColumn] : null);

      let channel = knownId ? guild.channels.cache.get(knownId) : null;
      if (!channel) channel = guild.channels.cache.find((c) => c.name === spec.name);

      if (channel) {
        created[spec.key] = channel.id;

        // Le plan a changé de nom : on renomme sur place, ce qui conserve
        // tout l'historique des messages du salon.
        if (channel.name !== spec.name) {
          try {
            await channel.setName(spec.name, 'CarréBot — mise à jour du plan');
            report.channels.push({ name: spec.name, status: 'renommé' });
            report.renamed.push(`**${spec.name}** (historique conservé)`);
          } catch {
            report.channels.push({ name: channel.name, status: 'existant' });
          }
        } else {
          report.channels.push({ name: spec.name, status: 'existant' });
        }

        // Répare les permissions qui auraient dérivé. Cas critique : un
        // salon membres ayant perdu son `deny ViewChannel` sur @everyone
        // est lisible par les non-vérifiés.
        const fixed = await repairOverwrites(
          channel, spec.access ?? cat.access, ids, spec, report,
        );
        report.repaired += fixed > 0 ? 1 : 0;
        continue;
      }

      try {
        channel = await guild.channels.create({
          name: spec.name,
          type: channelType(spec),
          parent: category.id,
          topic: spec.type === 'voice' ? undefined : spec.topic,
          userLimit: spec.userLimit,
          permissionOverwrites: buildOverwrites(
            spec.access ?? cat.access,
            ids,
            { readOnly: spec.readOnly },
          ),
          reason: 'CarréBot — setup',
        });
        created[spec.key] = channel.id;
        report.channels.push({ name: spec.name, status: 'créé' });
      } catch (err) {
        report.warnings.push(`Salon **${spec.name}** non créé : ${err.message}`);
      }
    }
  }

  return created;
}

/**
 * Réapplique les permissions du plan sur un salon existant.
 *
 * On modifie entrée par entrée avec `edit()`, jamais `set()` : `set()`
 * remplacerait la totalité des permissions du salon et effacerait les
 * réglages ajoutés à la main (accès invité, bot tiers, rôle VIP…).
 *
 * Un serveur sain ne déclenche aucun appel API : la comparaison préalable
 * court-circuite tout ce qui est déjà correct.
 */
async function repairOverwrites(channel, access, ids, spec, report) {
  const wanted = buildOverwrites(access, ids, { readOnly: spec?.readOnly });
  let repaired = 0;

  for (const entry of wanted) {
    if (!entry.id) continue;

    const current = channel.permissionOverwrites?.cache?.get(entry.id);
    const allowOk = (entry.allow ?? []).every((p) => current?.allow?.has(p));
    const denyOk = (entry.deny ?? []).every((p) => current?.deny?.has(p));
    if (current && allowOk && denyOk) continue;

    try {
      await channel.permissionOverwrites.edit(
        entry.id,
        {
          ...Object.fromEntries((entry.allow ?? []).map((p) => [permName(p), true])),
          ...Object.fromEntries((entry.deny ?? []).map((p) => [permName(p), false])),
        },
        { reason: 'CarréBot — réparation des permissions' },
      );
      repaired++;
    } catch (err) {
      report.warnings.push(`Permissions de **${channel.name}** non réparées : ${err.message}`);
      break;
    }
  }

  return repaired;
}

/**
 * Republie un panneau du bot dans un salon.
 *
 * On supprime les anciennes versions avant de reposter, plutôt que de les
 * éditer : l'édition échouait dès que le panneau sortait de la fenêtre de
 * lecture, et le contenu restait figé sur une version obsolète. Reposter
 * garantit que le panneau affiché correspond toujours au code.
 */
async function republishPanel(channel, prefix, payload) {
  // 50 messages : large de quoi couvrir plusieurs panneaux empilés par
  // des exécutions successives.
  const existing = await channel.messages.fetch({ limit: 50 });

  // Le customId peut arriver en camelCase (objet discord.js) ou en
  // snake_case (données brutes de l'API selon le type de composant) :
  // lire une seule des deux formes laisserait des doublons en place.
  const idOf = (row) => {
    const c = row?.components?.[0];
    return c?.customId ?? c?.custom_id ?? null;
  };

  const mine = existing.filter((m) =>
    m.author.id === channel.client.user.id
    && String(idOf(m.components?.[0]) ?? '').startsWith(prefix),
  );

  let deleted = 0;
  for (const message of mine.values()) {
    const ok = await message.delete().then(() => true).catch(() => false);
    if (ok) deleted++;
  }

  const sent = await channel.send(payload);

  log.info(
    `Panneau « ${prefix} » republié dans #${channel.name} — `
    + `${deleted} ancien(s) supprimé(s), nouveau message ${sent.id}`,
  );

  return { deleted, messageId: sent.id };
}

/** Publie les panneaux de rangs et d'identité dans le salon 🎭-roles. */
async function publishRankPanel(guild, created, cfg, report) {
  const channelId = created.roles;
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);

    const panel = buildRankPanel(cfg);

    if (panel.components.length === 0) {
      report.warnings.push(
        'Panneau des rangs vide : aucun rang résolu. Relance `/setup`.',
      );
      log.warn('Panneau « ranks: » vide — aucun composant construit');
      return;
    }

    await republishPanel(channel, 'ranks:', panel);
  } catch (err) {
    report.warnings.push(`Panneau des rangs non publié : ${err.message}`);
    log.error('Panneau « ranks: » non publié', err);
  }
}

/**
 * Supprime les salons retirés du plan.
 *
 * ⚠️ Une suppression Discord est IRRÉVERSIBLE et emporte tout l'historique.
 * On ne supprime donc QUE les salons dont l'identifiant figure en base,
 * c'est-à-dire ceux que /setup a lui-même créés. Un salon portant le même
 * nom mais créé à la main n'est jamais touché.
 */
async function removeRetiredChannels(guild, cfg, report, enabled) {
  if (!enabled) return;

  const known = parseJsonColumn(cfg.channel_ids);

  for (const key of RETIRED_CHANNEL_KEYS) {
    const id = known[key];
    if (!id) continue; // Jamais créé par nous : on n'y touche pas.

    const channel = guild.channels.cache.get(id);
    if (!channel) continue;

    try {
      const name = channel.name;
      await channel.delete('CarréBot — salon retiré du plan');
      report.removed.push(`**${name}**`);
    } catch (err) {
      report.warnings.push(`Salon **${channel.name}** non supprimé : ${err.message}`);
    }
  }

  // Catégories retirées, même règle. Une catégorie encore peuplée n'est
  // jamais supprimée : elle contiendrait des salons créés à la main, que
  // la suppression rendrait orphelins sans prévenir.
  for (const key of RETIRED_CATEGORY_KEYS) {
    const id = known[`cat:${key}`];
    if (!id) continue;

    const category = guild.channels.cache.get(id);
    if (!category) continue;

    if (category.children?.cache.size > 0) {
      report.warnings.push(
        `Catégorie **${category.name}** conservée : elle contient encore des salons.`,
      );
      continue;
    }

    try {
      const name = category.name;
      await category.delete('CarréBot — catégorie retirée du plan');
      report.removed.push(`**${name}** (catégorie)`);
    } catch (err) {
      report.warnings.push(`Catégorie **${category.name}** non supprimée : ${err.message}`);
    }
  }
}

/**
 * Masque aux non-vérifiés les salons qui existaient avant le setup.
 *
 * L'appartenance au plan se juge sur l'IDENTIFIANT, jamais sur le nom :
 * un salon créé à la main qui porterait par hasard un nom du plan
 * échapperait autrement au verrouillage. La comparaison par nom subsiste
 * en second filet, pour les salons du plan que `created` n'aurait pas pu
 * référencer (création échouée en amont).
 */
async function lockLegacyChannels(guild, ids, created, report) {
  const managed = new Set(Object.values(created));
  const blueprintNames = new Set(
    CATEGORIES.flatMap((c) => [c.name, ...c.channels.map((ch) => ch.name)]),
  );

  let count = 0;

  for (const channel of guild.channels.cache.values()) {
    if (managed.has(channel.id)) continue;
    // Filet secondaire : un salon du plan dont la création a échoué n'a pas
    // d'identifiant dans `created`, mais ne doit pas être verrouillé.
    if (blueprintNames.has(channel.name)) continue;

    try {
      await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
      await channel.permissionOverwrites.edit(ids.verified, { ViewChannel: true });
      count++;
    } catch {
      // Salon hors de portée du bot : on continue sans bloquer le reste.
    }
  }

  return count;
}

/** Publie le panneau de vérification, s'il n'y est pas déjà. */
async function publishPanel(guild, created, report) {
  const channelId = created.verify;
  if (!channelId) {
    report.warnings.push('Salon de vérification introuvable — panneau non publié.');
    return;
  }

  try {
    const channel = await guild.channels.fetch(channelId);
    const existing = await channel.messages.fetch({ limit: 10 });

    const alreadyThere = existing.some((m) =>
      m.author.id === guild.client.user.id &&
      m.components?.[0]?.components?.[0]?.customId === 'verify:start',
    );
    if (alreadyThere) return;

    await channel.send(buildVerifyPanel());
  } catch (err) {
    report.warnings.push(`Panneau non publié : ${err.message}`);
  }
}

/**
 * Poste un embed de présentation dans les salons qui en ont un.
 *
 * Ces salons resteraient sans explication : l'embed indique à quoi ils
 * servent et comment y participer (boutons plutôt que messages).
 *
 * L'intro est ÉPINGLÉE. Dans un salon où les membres écrivent, elle sortirait
 * sinon de la fenêtre de lecture, et /setup la reposterait à chaque passage.
 * On la cherche donc parmi les messages épinglés, pas parmi les derniers.
 */
async function publishIntros(guild, created, report) {
  for (const [key, intro] of Object.entries(CHANNEL_INTROS)) {
    const channelId = created[key];
    if (!channelId) continue;

    try {
      const channel = await guild.channels.fetch(channelId);

      const pinned = await channel.messages.fetchPinned().catch(() => null);
      const alreadyPinned = pinned?.some((m) => m.author.id === guild.client.user.id);
      if (alreadyPinned) continue;

      // Repli pour les intros publiées avant l'épinglage : on regarde aussi
      // les premiers messages du salon.
      const existing = await channel.messages.fetch({ limit: 10, after: '0' });
      const already = existing.some((m) => m.author.id === guild.client.user.id);
      if (already) continue;

      const embed = new EmbedBuilder()
        .setColor(intro.color)
        .setTitle(intro.title)
        .setDescription(intro.description);

      if (intro.footer) embed.setFooter({ text: intro.footer });

      const sent = await channel.send({ embeds: [embed] });
      // L'épinglage peut échouer (50 épingles max par salon) sans que ce
      // soit grave : l'intro est publiée, c'est l'essentiel.
      await sent.pin('CarréBot — présentation du salon').catch(() => {});
    } catch (err) {
      report.warnings.push(`Présentation de **${key}** non publiée : ${err.message}`);
    }
  }
}

/** Signale le piège classique : rôle du bot trop bas dans la hiérarchie. */
function checkHierarchy(guild, me, roleIds, report) {
  const verified = guild.roles.cache.get(roleIds.verified);
  if (verified && verified.position >= me.roles.highest.position) {
    report.warnings.push(
      `Mon rôle est **sous** ${verified} : je ne pourrai pas l'attribuer. ` +
      'Déplace-le plus haut dans **Paramètres du serveur → Rôles**.',
    );
  }
}

/** Compte les éléments par statut pour un résumé lisible. */
function summarize(items) {
  const created = items.filter((i) => i.status.startsWith('cré')).length;
  const existing = items.length - created;
  return { created, existing };
}

function buildReport(report) {
  const r = summarize(report.roles);
  const c = summarize(report.categories);
  const ch = summarize(report.channels);

  const adopted = report.ranks.filter((x) => x.status === 'adopté').length;
  const rankCreated = report.ranks.filter((x) => x.status === 'créé').length;
  const rankKept = report.ranks.length - adopted - rankCreated;

  const line = (label, s) =>
    `${label} : **${s.created}** créé(s)` + (s.existing ? `, ${s.existing} réutilisé(s)` : '');

  const rankLine = report.ranks.length === 0
    ? null
    : `🏅 Rangs CS2 : **${rankCreated}** créé(s)`
      + (adopted ? `, **${adopted}** adopté(s)` : '')
      + (rankKept ? `, ${rankKept} réutilisé(s)` : '');

  // Les rôles déjà connus comptent aussi : sans eux, un serveur déjà
  // configuré afficherait « 0 » et laisserait croire à un échec.
  const idCreated = report.identity.filter((x) => x.status === 'créé').length;
  const idAdopted = report.identity.filter((x) => x.status === 'adopté').length;
  const idKept = report.identity.length - idCreated - idAdopted;

  const identityLine = report.identity.length === 0
    ? null
    : `🧩 Rôles d'identité : **${report.identity.length}** actif(s)`
      + ` (${[
        idCreated ? `${idCreated} créé(s)` : null,
        idAdopted ? `${idAdopted} adopté(s)` : null,
        idKept ? `${idKept} réutilisé(s)` : null,
      ].filter(Boolean).join(', ')})`;

  const embed = new EmbedBuilder()
    .setColor(report.warnings.length > 0 ? COLORS.warning : COLORS.success)
    .setTitle('✅ Serveur configuré')
    .setDescription(
      [
        line('🎭 Rôles', r),
        rankLine,
        identityLine,
        line('📂 Catégories', c),
        line('📁 Salons', ch),
        report.repaired > 0
          ? `🔧 Permissions réparées : **${report.repaired}** salon(s)`
          : null,
        report.locked > 0
          ? `🔒 Salons préexistants masqués aux non-vérifiés : **${report.locked}**`
          : null,
      ].filter(Boolean).join('\n'),
    );

  if (report.renamed.length > 0) {
    embed.addFields({
      name: `✏️ Salons renommés (${report.renamed.length})`,
      value: report.renamed.slice(0, 8).map((r) => `• ${r}`).join('\n').slice(0, 1024),
    });
  }

  if (report.removed.length > 0) {
    embed.addFields({
      name: `🗑️ Salons supprimés (${report.removed.length})`,
      value: report.removed.slice(0, 8).map((r) => `• ${r}`).join('\n').slice(0, 1024),
    });
  }

  if (report.ghosts.length > 0) {
    embed.addFields({
      name: `🧹 Références obsolètes nettoyées (${report.ghosts.length})`,
      value: report.ghosts.slice(0, 8).map((g) => `• ${g}`).join('\n').slice(0, 1024),
    });
  }

  embed.addFields({
    name: '▶️ Et maintenant ?',
    value:
      'Le serveur est prêt : la vérification est active et les panneaux publiés.\n' +
      'Les membres choisissent leur rang dans **#🎭-roles**.\n' +
      'Teste avec un second compte pour vérifier le parcours d\'arrivée.',
  });

  if (report.warnings.length > 0) {
    embed.addFields({
      name: `⚠️ Points à vérifier (${report.warnings.length})`,
      value: report.warnings.slice(0, 5).map((w) => `• ${w}`).join('\n').slice(0, 1024),
    });
  }

  return embed;
}
