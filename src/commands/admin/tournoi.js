import {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { query } from '../../db/index.js';
import { COLORS } from '../../lib/config.js';
import { parseDuration } from '../../lib/time.js';
import { createTournament } from '../../lib/events.js';
import { isValidUrl } from '../../lib/publication.js';

export const data = new SlashCommandBuilder()
  .setName('tournoi')
  .setDescription('Gestion des tournois et events')
  .addSubcommand((s) =>
    s.setName('créer')
      .setDescription('Créer un nouveau tournoi')
      .addStringOption((o) =>
        o.setName('nom').setDescription('Nom du tournoi').setRequired(true).setMaxLength(100))
      .addStringOption((o) =>
        o.setName('format')
          .setDescription('Format de jeu')
          .setRequired(true)
          .addChoices(
            { name: '5v5 Compétitif', value: '5v5' },
            { name: '2v2 Wingman',    value: '2v2' },
            { name: '1v1 Aim',        value: '1v1' },
            { name: 'Autre / Event',  value: 'Event' },
          ))
      .addStringOption((o) =>
        o.setName('début')
          .setDescription('Dans combien de temps ? (ex : 2d, 12h, 90m)')
          .setRequired(true))
      .addStringOption((o) =>
        o.setName('description').setDescription('Détails, règles, lots…').setMaxLength(1000))
      .addIntegerOption((o) =>
        o.setName('équipes').setDescription('Nombre max d\'équipes/joueurs').setMinValue(2).setMaxValue(128))
      .addStringOption((o) =>
        o.setName('image').setDescription('Lien d\'une bannière (https://…)').setMaxLength(500))
      .addStringOption((o) =>
        o.setName('elite_avant')
          .setDescription('Réserver les inscriptions aux Elite pendant… (ex : 12h, 2d)')
          .setMaxLength(20))
      .addStringOption((o) =>
        o.setName('mention')
          .setDescription('Qui notifier ?')
          .addChoices(
            { name: '@everyone', value: 'everyone' },
            { name: '@here',     value: 'here' },
            { name: 'Personne',  value: 'none' },
          )))
  .addSubcommand((s) =>
    s.setName('liste').setDescription('Voir les tournois en cours'))
  .addSubcommand((s) =>
    s.setName('participants')
      .setDescription('Voir les inscrits d\'un tournoi')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du tournoi').setRequired(true)))
  .addSubcommand((s) =>
    s.setName('fermer')
      .setDescription('Clôturer les inscriptions d\'un tournoi')
      .addIntegerOption((o) =>
        o.setName('id').setDescription('ID du tournoi').setRequired(true)))
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents);

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'créer') return handleCreate(interaction);
  if (sub === 'liste') return listTournaments(interaction);
  if (sub === 'participants') return listParticipants(interaction);
  if (sub === 'fermer') return closeTournament(interaction);
}

/**
 * Création : la commande valide les entrées, le moteur commun publie.
 * `createTournament` (lib/events.js) sert aussi le panneau de publication —
 * un seul chemin, donc un seul rendu et un seul jeu de colonnes écrites.
 */
async function handleCreate(interaction) {
  const name = interaction.options.getString('nom');
  const format = interaction.options.getString('format');
  const startIn = interaction.options.getString('début');
  const description = interaction.options.getString('description');
  const maxTeams = interaction.options.getInteger('équipes');
  const imageUrl = interaction.options.getString('image');
  const eliteBefore = interaction.options.getString('elite_avant');
  const mentionChoice = interaction.options.getString('mention');

  const ms = parseDuration(startIn);
  if (ms === null) {
    return interaction.reply({
      content: '❌ Format de durée invalide. Utilise par exemple `2d`, `12h`, `90m` ou `1d6h`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (imageUrl && !isValidUrl(imageUrl)) {
    return interaction.reply({
      content: '❌ Le lien de l\'image doit commencer par `http://` ou `https://`.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const startsAt = new Date(Date.now() + ms);

  // Fenêtre Elite : bornée au début du tournoi, sinon les inscriptions
  // s'ouvriraient à tous après coup — ce qui n'aurait aucun sens.
  let publicSignupsAt = null;
  if (eliteBefore) {
    const windowMs = parseDuration(eliteBefore);
    if (windowMs === null) {
      return interaction.reply({
        content: '❌ Durée d\'accès anticipé invalide. Utilise par exemple `12h` ou `2d`.',
        flags: MessageFlags.Ephemeral,
      });
    }
    publicSignupsAt = new Date(Math.min(Date.now() + windowMs, startsAt.getTime()));
  }

  const { id } = await createTournament({
    guildId: interaction.guild.id,
    channel: interaction.channel,
    name, description, format, maxTeams, startsAt,
    createdBy: interaction.user.id,
    imageUrl,
    publicSignupsAt,
    mention: mentionChoice === 'none' ? null : mentionChoice,
  });

  return interaction.reply({
    content: `✅ Tournoi **${name}** créé (ID \`${id}\`).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function listTournaments(interaction) {
  const { rows } = await query(
    `SELECT t.*, COUNT(s.user_id)::int AS signups
     FROM tournaments t
     LEFT JOIN tournament_signups s ON s.tournament_id = t.id
     WHERE t.guild_id = $1 AND t.status = 'open'
     GROUP BY t.id ORDER BY t.starts_at ASC`,
    [interaction.guild.id],
  );

  if (rows.length === 0) {
    return interaction.reply({
      content: 'Aucun tournoi ouvert pour le moment.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle('🏆 Tournois ouverts')
    .setDescription(
      rows.map((t) =>
        `**#${t.id} — ${t.name}**\n` +
        `${t.format} · ${t.signups}${t.max_teams ? `/${t.max_teams}` : ''} inscrit(s) · ` +
        `<t:${Math.floor(new Date(t.starts_at).getTime() / 1000)}:R>`,
      ).join('\n\n'),
    );

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function listParticipants(interaction) {
  const id = interaction.options.getInteger('id');

  const { rows: t } = await query(
    'SELECT * FROM tournaments WHERE id = $1 AND guild_id = $2',
    [id, interaction.guild.id],
  );
  if (t.length === 0) {
    return interaction.reply({
      content: '❌ Tournoi introuvable.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const { rows: signups } = await query(
    'SELECT user_id, team_name, signed_at FROM tournament_signups WHERE tournament_id = $1 ORDER BY signed_at',
    [id],
  );

  const embed = new EmbedBuilder()
    .setColor(COLORS.primary)
    .setTitle(`👥 Inscrits — ${t[0].name}`)
    .setDescription(
      signups.length === 0
        ? 'Aucun inscrit pour l\'instant.'
        : signups.map((s, i) =>
            `**${i + 1}.** <@${s.user_id}>${s.team_name ? ` — *${s.team_name}*` : ''}`,
          ).join('\n'),
    )
    .setFooter({ text: `${signups.length} inscrit(s)` });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function closeTournament(interaction) {
  const id = interaction.options.getInteger('id');

  const { rowCount } = await query(
    `UPDATE tournaments SET status = 'closed'
     WHERE id = $1 AND guild_id = $2 AND status = 'open'`,
    [id, interaction.guild.id],
  );

  if (rowCount === 0) {
    return interaction.reply({
      content: '❌ Tournoi introuvable ou déjà clôturé.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: `🔒 Inscriptions du tournoi \`#${id}\` clôturées.`,
    flags: MessageFlags.Ephemeral,
  });
}
