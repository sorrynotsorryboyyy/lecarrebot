import { MessageFlags } from 'discord.js';
import { query } from '../db/index.js';
import { buildTournamentMessage } from '../lib/embeds.js';

/** Réécrit le message d'un tournoi à partir de l'état en base. */
async function refresh(interaction, tournamentId) {
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const t = rows[0];
  if (!t) return;

  const { rows: signups } = await query(
    'SELECT user_id FROM tournament_signups WHERE tournament_id = $1 ORDER BY signed_at',
    [tournamentId],
  );

  await interaction.message.edit(
    buildTournamentMessage({
      id: t.id,
      name: t.name,
      description: t.description,
      format: t.format,
      maxTeams: t.max_teams,
      startsAt: t.starts_at,
      signups: signups.map((s) => s.user_id),
      status: t.status,
    }),
  );
}

export async function joinTournament(interaction, tournamentId) {
  const { rows } = await query('SELECT * FROM tournaments WHERE id = $1', [tournamentId]);
  const t = rows[0];

  if (!t || t.status !== 'open') {
    return interaction.reply({
      content: '🔒 Les inscriptions de ce tournoi sont fermées.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Insertion et contrôle de capacité en une seule requête : deux clics
  // simultanés ne peuvent pas faire dépasser le nombre de places.
  // `max_teams` peut être NULL (tournoi sans limite) : on le neutralise
  // avec une borne toujours vraie.
  const inserted = await query(
    `INSERT INTO tournament_signups (tournament_id, user_id)
     SELECT $1, $2
     WHERE $3::int IS NULL
        OR (SELECT COUNT(*) FROM tournament_signups WHERE tournament_id = $1) < $3
     ON CONFLICT DO NOTHING
     RETURNING user_id`,
    [tournamentId, interaction.user.id, t.max_teams],
  );

  if (inserted.rowCount === 0) {
    const { rows: mine } = await query(
      'SELECT 1 FROM tournament_signups WHERE tournament_id = $1 AND user_id = $2',
      [tournamentId, interaction.user.id],
    );

    return interaction.reply({
      content: mine.length > 0
        ? 'ℹ️ Tu es déjà inscrit à ce tournoi.'
        : '❌ Le tournoi est complet.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: `✅ Inscription confirmée pour **${t.name}** ! Rendez-vous <t:${Math.floor(new Date(t.starts_at).getTime() / 1000)}:R>.`,
    flags: MessageFlags.Ephemeral,
  });

  await refresh(interaction, tournamentId);
}

export async function leaveTournament(interaction, tournamentId) {
  const { rowCount } = await query(
    'DELETE FROM tournament_signups WHERE tournament_id = $1 AND user_id = $2',
    [tournamentId, interaction.user.id],
  );

  if (rowCount === 0) {
    return interaction.reply({
      content: 'ℹ️ Tu n\'es pas inscrit à ce tournoi.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.reply({
    content: '👋 Tu es désinscrit du tournoi.',
    flags: MessageFlags.Ephemeral,
  });

  await refresh(interaction, tournamentId);
}
