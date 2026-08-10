import { EmbedBuilder, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import {
  StatsError,
  fetchFaceit,
  fetchSteam,
  isFaceitEnabled,
  isSteamEnabled,
  readLinks,
  readStats,
  resolveSteamId,
  saveStats,
} from '../../lib/stats.js';
import { log } from '../../lib/logger.js';

/**
 * /lier — rattache un compte Faceit ou Steam à un membre.
 *
 * Les statistiques sont lues une fois à la liaison, puis servies depuis le
 * cache. Valve n'exposant aucune API de cote Premier, celle-ci reste
 * déclarative via les menus de #🎭-roles.
 */
export const data = new SlashCommandBuilder()
  .setName('lier')
  .setDescription('Lie ton compte Faceit ou Steam à ton profil')
  .addSubcommand((s) =>
    s.setName('faceit')
      .setDescription('Lier ton compte Faceit')
      .addStringOption((o) =>
        o.setName('pseudo')
          .setDescription('Ton pseudo Faceit exact')
          .setRequired(true)
          .setMaxLength(64)))
  .addSubcommand((s) =>
    s.setName('steam')
      .setDescription('Lier ton compte Steam')
      .addStringOption((o) =>
        o.setName('profil')
          .setDescription('URL de ton profil Steam, ou ton SteamID64')
          .setRequired(true)
          .setMaxLength(200)))
  .addSubcommand((s) =>
    s.setName('voir').setDescription('Voir tes comptes liés'))
  .addSubcommand((s) =>
    s.setName('actualiser').setDescription('Rafraîchir tes statistiques'))
  .addSubcommand((s) =>
    s.setName('delier')
      .setDescription('Retirer un compte lié')
      .addStringOption((o) =>
        o.setName('source')
          .setDescription('Quel compte retirer ?')
          .setRequired(true)
          .addChoices(
            { name: 'Faceit', value: 'faceit' },
            { name: 'Steam',  value: 'steam' },
            { name: 'Les deux', value: 'all' },
          )));

/** Délai minimal entre deux rafraîchissements manuels. */
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000;

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'faceit') return linkFaceit(interaction);
  if (sub === 'steam') return linkSteam(interaction);
  if (sub === 'voir') return showLinks(interaction);
  if (sub === 'actualiser') return refresh(interaction);
  if (sub === 'delier') return unlink(interaction);
}

/** Réponse commune aux erreurs de source. */
async function fail(interaction, err) {
  if (err instanceof StatsError) return interaction.editReply(`❌ ${err.message}`);

  log.warn(`Liaison impossible : ${err.message}`);
  return interaction.editReply(
    '❌ Une erreur est survenue. Réessaie dans quelques minutes.',
  );
}

async function linkFaceit(interaction) {
  if (!isFaceitEnabled()) {
    return interaction.reply({
      content: '⚠️ Les statistiques Faceit ne sont pas configurées sur ce bot.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // L'appel réseau dépasse largement les 3 secondes d'une réponse directe.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const nickname = interaction.options.getString('pseudo').trim();

  try {
    const data = await fetchFaceit(nickname);

    await query(
      `INSERT INTO member_links (guild_id, user_id, faceit_nickname, faceit_player_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET faceit_nickname = EXCLUDED.faceit_nickname,
                     faceit_player_id = EXCLUDED.faceit_player_id,
                     linked_at = NOW()`,
      [interaction.guild.id, interaction.user.id, data.nickname, data.playerId],
    );

    await saveStats(interaction.guild.id, interaction.user.id, 'faceit', data);

    return interaction.editReply(
      `✅ Compte Faceit **${data.nickname}** lié !\n` +
      `> Niveau **${data.level ?? '?'}** · **${data.elo ?? '?'}** Elo\n\n` +
      'Tes stats apparaissent maintenant dans `/profil`.',
    );
  } catch (err) {
    return fail(interaction, err);
  }
}

async function linkSteam(interaction) {
  if (!isSteamEnabled()) {
    return interaction.reply({
      content: '⚠️ Les statistiques Steam ne sont pas configurées sur ce bot.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const input = interaction.options.getString('profil').trim();

  try {
    const steamId = await resolveSteamId(input);
    const data = await fetchSteam(steamId);

    await query(
      `INSERT INTO member_links (guild_id, user_id, steam_id64)
       VALUES ($1, $2, $3)
       ON CONFLICT (guild_id, user_id)
       DO UPDATE SET steam_id64 = EXCLUDED.steam_id64, linked_at = NOW()`,
      [interaction.guild.id, interaction.user.id, steamId],
    );

    await saveStats(interaction.guild.id, interaction.user.id, 'steam', data);

    const details = [
      data.hours != null ? `**${data.hours}** h de jeu` : null,
      data.kills != null ? `**${data.kills.toLocaleString('fr-FR')}** kills` : null,
    ].filter(Boolean).join(' · ');

    return interaction.editReply(
      `✅ Compte Steam **${data.name ?? steamId}** lié !` +
      (details ? `\n> ${details}` : '') +
      '\n\nTes stats apparaissent maintenant dans `/profil`.',
    );
  } catch (err) {
    return fail(interaction, err);
  }
}

async function showLinks(interaction) {
  const links = await readLinks(interaction.guild.id, interaction.user.id);
  const stats = await readStats(interaction.guild.id, interaction.user.id);

  if (!links || (!links.faceit_nickname && !links.steam_id64)) {
    return interaction.reply({
      content:
        'Tu n\'as aucun compte lié.\n\n' +
        '> `/lier faceit` — ton niveau et ton Elo\n' +
        '> `/lier steam` — tes heures et tes stats de jeu',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🔗 Tes comptes liés');

  if (links.faceit_nickname) {
    const f = stats.faceit;
    embed.addFields({
      name: '⚡ Faceit',
      value:
        `**${links.faceit_nickname}**\n` +
        (f
          ? `Niveau **${f.level ?? '?'}** · **${f.elo ?? '?'}** Elo` +
            (f.kd ? `\nK/D **${f.kd}** · Winrate **${f.winrate}%**` : '')
          : '*statistiques indisponibles*'),
      inline: true,
    });
  }

  if (links.steam_id64) {
    const s = stats.steam;
    embed.addFields({
      name: '🎮 Steam',
      value:
        `**${s?.name ?? links.steam_id64}**\n` +
        (s
          ? [
              s.hours != null ? `**${s.hours}** h de jeu` : null,
              s.kills != null ? `**${s.kills.toLocaleString('fr-FR')}** kills` : null,
            ].filter(Boolean).join('\n') || '*aucune statistique publique*'
          : '*statistiques indisponibles*'),
      inline: true,
    });
  }

  embed.setFooter({ text: 'Actualise avec /lier actualiser · Retire avec /lier delier' });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function refresh(interaction) {
  const links = await readLinks(interaction.guild.id, interaction.user.id);

  if (!links || (!links.faceit_nickname && !links.steam_id64)) {
    return interaction.reply({
      content: 'Tu n\'as aucun compte lié. Commence par `/lier faceit` ou `/lier steam`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Garde-fou contre le martèlement des API tierces.
  const stats = await readStats(interaction.guild.id, interaction.user.id);
  const last = [stats.faceit?.fetchedAt, stats.steam?.fetchedAt]
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .sort((a, b) => b - a)[0];

  if (last && Date.now() - last < REFRESH_COOLDOWN_MS) {
    const ready = Math.floor((last + REFRESH_COOLDOWN_MS) / 1000);
    return interaction.reply({
      content: `⏱️ Tes stats sont déjà à jour. Tu pourras réactualiser <t:${ready}:R>.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const done = [];
  const failed = [];

  if (links.faceit_nickname && isFaceitEnabled()) {
    try {
      const data = await fetchFaceit(links.faceit_nickname);
      await saveStats(interaction.guild.id, interaction.user.id, 'faceit', data);
      done.push(`⚡ Faceit — niveau **${data.level ?? '?'}**, **${data.elo ?? '?'}** Elo`);
    } catch (err) {
      failed.push(`⚡ Faceit : ${err instanceof StatsError ? err.message : 'indisponible'}`);
    }
  }

  if (links.steam_id64 && isSteamEnabled()) {
    try {
      const data = await fetchSteam(links.steam_id64);
      await saveStats(interaction.guild.id, interaction.user.id, 'steam', data);
      done.push(`🎮 Steam — **${data.hours ?? '?'}** h de jeu`);
    } catch (err) {
      failed.push(`🎮 Steam : ${err instanceof StatsError ? err.message : 'indisponible'}`);
    }
  }

  const lines = [
    done.length > 0 ? `✅ Statistiques actualisées :\n> ${done.join('\n> ')}` : null,
    failed.length > 0 ? `\n⚠️ ${failed.join('\n')}` : null,
  ].filter(Boolean);

  return interaction.editReply(lines.join('\n') || '⚠️ Aucune source disponible.');
}

async function unlink(interaction) {
  const source = interaction.options.getString('source');

  if (source === 'all') {
    await query(
      'DELETE FROM member_links WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, interaction.user.id],
    );
    await query(
      'DELETE FROM stats_cache WHERE guild_id = $1 AND user_id = $2',
      [interaction.guild.id, interaction.user.id],
    );

    return interaction.reply({
      content: '✅ Tous tes comptes ont été retirés.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const column = source === 'faceit' ? 'faceit_nickname' : 'steam_id64';
  const extra = source === 'faceit' ? ', faceit_player_id = NULL' : '';

  await query(
    `UPDATE member_links SET ${column} = NULL${extra} WHERE guild_id = $1 AND user_id = $2`,
    [interaction.guild.id, interaction.user.id],
  );
  await query(
    'DELETE FROM stats_cache WHERE guild_id = $1 AND user_id = $2 AND source = $3',
    [interaction.guild.id, interaction.user.id, source],
  );

  return interaction.reply({
    content: `✅ Ton compte **${source === 'faceit' ? 'Faceit' : 'Steam'}** a été retiré.`,
    flags: MessageFlags.Ephemeral,
  });
}
