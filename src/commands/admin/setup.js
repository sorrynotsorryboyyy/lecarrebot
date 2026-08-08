import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, updateGuildConfig } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { log } from '../../lib/logger.js';
import { buildVerifyPanel, DEFAULT_RULES } from '../../handlers/verification.js';
import {
  CATEGORIES,
  CHANNEL_CONFIG_KEYS,
  CHANNEL_INTROS,
  ROLES,
  buildOverwrites,
  channelType,
} from '../../lib/blueprint.js';

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
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  // La création complète dépasse largement les 3s d'une réponse directe.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guild = interaction.guild;
  const me = guild.members.me;
  const lockExisting = interaction.options.getBoolean('verrouiller_existant') ?? true;

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

  const report = { roles: [], categories: [], channels: [], locked: 0, warnings: [] };
  const cfg = await getGuildConfig(guild.id);
  const patch = {};

  try {
    // ─── 1. Rôles ────────────────────────────────────────────────
    const roleIds = await ensureRoles(guild, cfg, report);
    patch.verified_role_id = roleIds.verified;

    // La suite dépend du rôle vérifié : sans lui, rien n'a de sens.
    if (!roleIds.verified) {
      return interaction.editReply(
        '❌ Impossible de créer ou retrouver le rôle vérifié. Vérifie mes permissions.',
      );
    }

    const ids = {
      everyone: guild.roles.everyone.id,
      verified: roleIds.verified,
      moderator: roleIds.moderator,
      admin: roleIds.admin,
      bot: me.id,
    };

    // ─── 2. Catégories et salons ─────────────────────────────────
    const created = await ensureStructure(guild, cfg, ids, report);
    for (const [key, column] of Object.entries(CHANNEL_CONFIG_KEYS)) {
      if (created[key]) patch[column] = created[key];
    }

    // ─── 3. Salons préexistants ──────────────────────────────────
    // Sans cette étape, la vérification serait décorative : un arrivant
    // verrait déjà tout ce qui existait avant le setup.
    if (lockExisting) {
      report.locked = await lockLegacyChannels(guild, ids, created, report);
    }

    await updateGuildConfig(guild.id, patch);

    // ─── 4. Contenus : règlement, panneau, présentations ─────────
    await publishRules(guild, created, cfg, report);
    await publishPanel(guild, created, report);
    await publishIntros(guild, created, report);

    // ─── 5. Hiérarchie ───────────────────────────────────────────
    checkHierarchy(guild, me, roleIds, report);
  } catch (err) {
    log.error('Échec du setup', err);
    return interaction.editReply(
      `❌ Le setup s'est interrompu : ${err.message}\n\n` +
      'Les éléments déjà créés sont conservés — relance `/setup` pour reprendre.',
    );
  }

  return interaction.editReply({ embeds: [buildReport(report)] });
}

/** Crée les rôles manquants et renvoie leurs IDs par clé. */
async function ensureRoles(guild, cfg, report) {
  const ids = {};

  // Créés du plus bas au plus haut : chaque `create` place le rôle en haut
  // de ce que le bot peut atteindre, donc l'ordre inverse donne la bonne
  // hiérarchie finale (Admin > Modérateur > Vérifié).
  for (const spec of [...ROLES].reverse()) {
    const knownId = spec.key === 'verified' ? cfg.verified_role_id : null;

    let role = knownId ? guild.roles.cache.get(knownId) : null;
    if (!role) role = guild.roles.cache.find((r) => r.name === spec.name);

    if (role) {
      ids[spec.key] = role.id;
      report.roles.push({ name: spec.name, status: 'existant' });
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

  for (const cat of CATEGORIES) {
    let category = guild.channels.cache.find(
      (c) => c.type === 4 && c.name === cat.name,
    );

    if (!category) {
      try {
        category = await guild.channels.create({
          name: cat.name,
          type: 4, // GuildCategory
          permissionOverwrites: buildOverwrites(cat.access, ids),
          reason: 'CarréBot — setup',
        });
        report.categories.push({ name: cat.name, status: 'créée' });
      } catch (err) {
        report.warnings.push(`Catégorie **${cat.name}** non créée : ${err.message}`);
        continue;
      }
    } else {
      report.categories.push({ name: cat.name, status: 'existante' });
    }

    for (const spec of cat.channels) {
      const configColumn = CHANNEL_CONFIG_KEYS[spec.key];
      const knownId = configColumn ? cfg[configColumn] : null;

      let channel = knownId ? guild.channels.cache.get(knownId) : null;
      if (!channel) channel = guild.channels.cache.find((c) => c.name === spec.name);

      if (channel) {
        created[spec.key] = channel.id;
        report.channels.push({ name: spec.name, status: 'existant' });
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

/** Masque aux non-vérifiés les salons qui existaient avant le setup. */
async function lockLegacyChannels(guild, ids, created, report) {
  const managed = new Set(Object.values(created));
  const blueprintNames = new Set(
    CATEGORIES.flatMap((c) => [c.name, ...c.channels.map((ch) => ch.name)]),
  );

  let count = 0;

  for (const channel of guild.channels.cache.values()) {
    if (managed.has(channel.id)) continue;
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

/** Publie le règlement dans son salon, s'il est encore vide. */
async function publishRules(guild, created, cfg, report) {
  const channelId = created.rules;
  if (!channelId) return;

  try {
    const channel = await guild.channels.fetch(channelId);
    const existing = await channel.messages.fetch({ limit: 5 });

    // On ne republie pas si le salon contient déjà quelque chose : l'admin
    // a pu personnaliser son règlement à la main.
    if (existing.size > 0) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.primary)
      .setTitle('📜 Règlement du serveur')
      .setDescription(cfg.rules_text || DEFAULT_RULES)
      .setFooter({ text: 'Le non-respect du règlement peut entraîner une sanction.' });

    await channel.send({ embeds: [embed] });
  } catch (err) {
    report.warnings.push(`Règlement non publié : ${err.message}`);
  }
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
 * Poste un embed de présentation dans chaque salon en lecture seule.
 *
 * Ces salons resteraient vides et sans explication : l'embed indique à quoi
 * ils servent et comment y participer (boutons plutôt que messages).
 */
async function publishIntros(guild, created, report) {
  for (const [key, intro] of Object.entries(CHANNEL_INTROS)) {
    const channelId = created[key];
    if (!channelId) continue;

    try {
      const channel = await guild.channels.fetch(channelId);
      const existing = await channel.messages.fetch({ limit: 10 });

      // On ne republie pas si le bot a déjà posté ici : /setup est
      // relançable, elle ne doit pas empiler les présentations.
      const already = existing.some((m) => m.author.id === guild.client.user.id);
      if (already) continue;

      const embed = new EmbedBuilder()
        .setColor(intro.color)
        .setTitle(intro.title)
        .setDescription(intro.description);

      if (intro.footer) embed.setFooter({ text: intro.footer });

      await channel.send({ embeds: [embed] });
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

  const line = (label, s) =>
    `${label} : **${s.created}** créé(s)` + (s.existing ? `, ${s.existing} réutilisé(s)` : '');

  const embed = new EmbedBuilder()
    .setColor(report.warnings.length > 0 ? COLORS.warning : COLORS.success)
    .setTitle('✅ Serveur configuré')
    .setDescription(
      [
        line('🎭 Rôles', r),
        line('📂 Catégories', c),
        line('📁 Salons', ch),
        report.locked > 0
          ? `🔒 Salons préexistants masqués aux non-vérifiés : **${report.locked}**`
          : null,
      ].filter(Boolean).join('\n'),
    )
    .addFields({
      name: '▶️ Et maintenant ?',
      value:
        'Le serveur est prêt : la vérification est active et le panneau publié.\n' +
        'Teste-la avec un second compte, ou ajuste les détails avec `/config`.',
    });

  if (report.warnings.length > 0) {
    embed.addFields({
      name: `⚠️ Points à vérifier (${report.warnings.length})`,
      value: report.warnings.slice(0, 5).map((w) => `• ${w}`).join('\n').slice(0, 1024),
    });
  }

  return embed;
}
