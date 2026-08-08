import { MessageFlags } from 'discord.js';
import { query } from '../db/index.js';
import { buildLfgMessage } from '../lib/embeds.js';

/** Recharge une annonce et ses inscrits, puis réécrit le message d'origine. */
async function refresh(interaction, postId) {
  const { rows } = await query('SELECT * FROM lfg_posts WHERE id = $1', [postId]);
  const post = rows[0];
  if (!post) return null;

  const { rows: joins } = await query(
    'SELECT user_id FROM lfg_joins WHERE post_id = $1 ORDER BY joined_at',
    [postId],
  );

  const author = await interaction.client.users.fetch(post.user_id).catch(() => interaction.user);

  await interaction.message.edit(
    buildLfgMessage({
      id: post.id,
      author,
      mode: post.mode,
      rank: post.rank,
      slots: post.slots,
      note: post.note,
      joined: joins.map((j) => j.user_id),
      closed: post.closed,
    }),
  );

  return post;
}

export async function joinLfg(interaction, postId) {
  const { rows } = await query('SELECT * FROM lfg_posts WHERE id = $1', [postId]);
  const post = rows[0];

  if (!post || post.closed) {
    return interaction.reply({
      content: '🔒 Cette annonce est fermée.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (post.user_id === interaction.user.id) {
    return interaction.reply({
      content: '😅 Tu es déjà l\'auteur de cette annonce.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // L'insertion et le contrôle de capacité sont faits en une seule requête.
  // Séparés, plusieurs clics simultanés passeraient tous le test avant qu'aucun
  // n'ait inséré, et l'annonce dépasserait le nombre de places.
  const inserted = await query(
    `INSERT INTO lfg_joins (post_id, user_id)
     SELECT $1, $2
     WHERE (SELECT COUNT(*) FROM lfg_joins WHERE post_id = $1) < $3
     ON CONFLICT DO NOTHING
     RETURNING user_id`,
    [postId, interaction.user.id, post.slots],
  );

  if (inserted.rowCount === 0) {
    // Zéro ligne = soit déjà inscrit, soit complet. On distingue les deux
    // pour ne pas afficher un message trompeur.
    const { rows: mine } = await query(
      'SELECT 1 FROM lfg_joins WHERE post_id = $1 AND user_id = $2',
      [postId, interaction.user.id],
    );

    return interaction.reply({
      content: mine.length > 0
        ? 'ℹ️ Tu es déjà inscrit sur cette annonce.'
        : '❌ Toutes les places sont prises.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  await refresh(interaction, postId);

  // Prévient l'auteur — c'est tout l'intérêt du LFG : être notifié.
  await interaction.client.users.fetch(post.user_id)
    .then((u) => u.send(
      `🎯 **${interaction.user.tag}** a rejoint ton annonce LFG (${post.mode}) sur **${interaction.guild.name}** !`,
    ))
    .catch(() => {});
}

export async function leaveLfg(interaction, postId) {
  const { rowCount } = await query(
    'DELETE FROM lfg_joins WHERE post_id = $1 AND user_id = $2',
    [postId, interaction.user.id],
  );

  if (rowCount === 0) {
    return interaction.reply({
      content: 'ℹ️ Tu n\'es pas inscrit sur cette annonce.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferUpdate();
  await refresh(interaction, postId);
}

export async function closeLfg(interaction, postId) {
  const { rows } = await query('SELECT * FROM lfg_posts WHERE id = $1', [postId]);
  const post = rows[0];
  if (!post) return;

  // Seuls l'auteur et les modérateurs peuvent fermer une annonce.
  const isAuthor = post.user_id === interaction.user.id;
  const isMod = interaction.memberPermissions?.has('ManageMessages');

  if (!isAuthor && !isMod) {
    return interaction.reply({
      content: '⛔ Seul l\'auteur de l\'annonce peut la fermer.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await query('UPDATE lfg_posts SET closed = TRUE WHERE id = $1', [postId]);
  await interaction.deferUpdate();
  await refresh(interaction, postId);
}
