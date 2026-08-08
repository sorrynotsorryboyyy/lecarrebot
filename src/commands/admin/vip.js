import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { getGuildConfig, query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { formatDuration, parseDuration } from '../../lib/time.js';
import { sendLog } from '../../handlers/logs.js';

export const data = new SlashCommandBuilder()
  .setName('vip')
  .setDescription('Gestion des membres Elite (VIP)')
  .addSubcommand((s) =>
    s.setName('ajouter')
      .setDescription('Accorder le statut VIP à un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
      .addStringOption((o) =>
        o.setName('durée')
          .setDescription('Durée (ex : 30d, 3mo). Illimité si non précisé.'))
      .addStringOption((o) =>
        o.setName('raison').setDescription('Motif (boost, don, récompense…)').setMaxLength(200)))
  .addSubcommand((s) =>
    s.setName('retirer')
      .setDescription('Retirer le statut VIP')
      .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('liste').setDescription('Voir les membres VIP'))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  switch (interaction.options.getSubcommand()) {
    case 'ajouter': return addVip(interaction);
    case 'retirer': return removeVip(interaction);
    case 'liste':   return listVips(interaction);
  }
}

async function addVip(interaction) {
  const user = interaction.options.getUser('membre');
  const durationRaw = interaction.options.getString('durée');
  const reason = interaction.options.getString('raison') ?? 'Non précisé';

  const cfg = await getGuildConfig(interaction.guild.id);
  if (!cfg.vip_role_id) {
    return interaction.reply({
      content: '⚠️ Le rôle VIP n\'est pas configuré. Lance `/setup`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (!member) {
    return interaction.reply({
      content: '❌ Membre introuvable sur ce serveur.',
      flags: MessageFlags.Ephemeral,
    });
  }

  let expiresAt = null;
  if (durationRaw) {
    const ms = parseDuration(durationRaw);
    if (ms === null) {
      return interaction.reply({
        content: '❌ Durée invalide. Exemples : `30d`, `7d`, `12h`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    expiresAt = new Date(Date.now() + ms);
  }

  try {
    await member.roles.add(cfg.vip_role_id, `VIP accordé par ${interaction.user.tag} — ${reason}`);
  } catch {
    return interaction.reply({
      content:
        '❌ Impossible d\'attribuer le rôle VIP. Mon rôle doit être **au-dessus** ' +
        'du rôle Elite dans **Paramètres du serveur → Rôles**.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await query(
    `INSERT INTO vip_members (guild_id, user_id, granted_by, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (guild_id, user_id)
     DO UPDATE SET granted_by = EXCLUDED.granted_by, expires_at = EXCLUDED.expires_at`,
    [interaction.guild.id, user.id, interaction.user.id, expiresAt],
  );

  await user.send(
    `💎 Tu es désormais **Elite (VIP)** sur **${interaction.guild.name}** !\n\n` +
    `**Motif :** ${reason}\n` +
    (expiresAt
      ? `**Durée :** ${formatDuration(expiresAt.getTime() - Date.now())}\n`
      : '**Durée :** illimitée\n') +
    '\nTu as accès aux giveaways réservés aux VIP.',
  ).catch(() => {});

  await sendLog(interaction.guild, {
    color: COLORS.success,
    title: '💎 Nouveau VIP',
    description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
    fields: [
      { name: 'Motif', value: reason },
      {
        name: 'Expiration',
        value: expiresAt ? `<t:${Math.floor(expiresAt.getTime() / 1000)}:R>` : 'illimitée',
        inline: true,
      },
    ],
  });

  return interaction.reply({
    content:
      `💎 ${user} est désormais **Elite (VIP)**` +
      (expiresAt ? ` pour **${formatDuration(expiresAt.getTime() - Date.now())}**.` : ' (illimité).'),
    flags: MessageFlags.Ephemeral,
  });
}

async function removeVip(interaction) {
  const user = interaction.options.getUser('membre');
  const cfg = await getGuildConfig(interaction.guild.id);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member && cfg.vip_role_id) {
    await member.roles.remove(cfg.vip_role_id, `VIP retiré par ${interaction.user.tag}`)
      .catch(() => {});
  }

  const { rowCount } = await query(
    'DELETE FROM vip_members WHERE guild_id = $1 AND user_id = $2',
    [interaction.guild.id, user.id],
  );

  if (rowCount > 0) {
    await sendLog(interaction.guild, {
      color: COLORS.warning,
      title: '💎 VIP retiré',
      description: `${user} (\`${user.tag}\`) par ${interaction.user}.`,
    });
  }

  return interaction.reply({
    content: rowCount > 0
      ? `✅ Statut VIP retiré à ${user}.`
      : `ℹ️ ${user} n'était pas VIP.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function listVips(interaction) {
  const { rows } = await query(
    'SELECT user_id, expires_at, created_at FROM vip_members WHERE guild_id = $1 ORDER BY created_at',
    [interaction.guild.id],
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('💎 Membres Elite (VIP)')
    .setDescription(
      rows.length === 0
        ? 'Aucun membre VIP pour le moment.'
        : rows.map((r) =>
            `• <@${r.user_id}> — ` +
            (r.expires_at
              ? `expire <t:${Math.floor(new Date(r.expires_at).getTime() / 1000)}:R>`
              : 'illimité'),
          ).join('\n').slice(0, 4000),
    )
    .setFooter({ text: `${rows.length} membre(s) VIP` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/**
 * Retire les statuts VIP expirés.
 * Appelée périodiquement depuis ready.js — même approche que le
 * planificateur de giveaways : la base fait foi, pas des minuteries en
 * mémoire qui ne survivraient pas à un redémarrage.
 */
export async function expireVips(client) {
  const { rows } = await query(
    'SELECT * FROM vip_members WHERE expires_at IS NOT NULL AND expires_at <= NOW()',
  );

  for (const row of rows) {
    try {
      const guild = client.guilds.cache.get(row.guild_id);
      if (!guild) continue;

      const cfg = await getGuildConfig(row.guild_id);
      const member = await guild.members.fetch(row.user_id).catch(() => null);

      if (member && cfg.vip_role_id) {
        await member.roles.remove(cfg.vip_role_id, 'Statut VIP expiré').catch(() => {});
        await member.send(
          `💎 Ton statut **Elite (VIP)** sur **${guild.name}** a expiré.\n\n` +
          'Merci de ton soutien ! Contacte le staff pour le renouveler.',
        ).catch(() => {});
      }

      await query(
        'DELETE FROM vip_members WHERE guild_id = $1 AND user_id = $2',
        [row.guild_id, row.user_id],
      );
    } catch {
      // Serveur ou membre indisponible : on réessaiera au prochain passage.
    }
  }
}

/** Le membre est-il VIP ? Utilisé par les giveaways réservés. */
export async function isVip(guildId, userId) {
  const { rows } = await query(
    `SELECT 1 FROM vip_members
     WHERE guild_id = $1 AND user_id = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [guildId, userId],
  );
  return rows.length > 0;
}
