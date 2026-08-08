import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { COLORS } from './config.js';

/**
 * Constructeurs de messages partagés entre les commandes (qui publient) et
 * les handlers (qui mettent à jour). Les isoler ici évite un cycle d'imports
 * commande ↔ handler, qui obligeait à des `await import()` fragiles.
 */

/** Embed + bouton de participation d'un giveaway. */
export function buildGiveawayMessage({
  id, prize, winners, endsAt, entries, ended, vipOnly = false, conditions = null,
}) {
  const ts = Math.floor(new Date(endsAt).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(ended ? COLORS.info : vipOnly ? 0x00d4ff : COLORS.warning)
    .setTitle(`${vipOnly ? '💎 ' : '🎁 '}${prize}`)
    .setDescription(
      ended
        ? '**Ce giveaway est terminé.**'
        : (vipOnly ? '💎 **Réservé aux membres Elite (VIP).**\n\n' : '')
          + `Clique sur 🎉 pour participer !\n\n**Fin :** <t:${ts}:F> (<t:${ts}:R>)`,
    )
    .addFields(
      { name: 'Gagnant(s)', value: String(winners), inline: true },
      { name: 'Participants', value: String(entries), inline: true },
    )
    .setFooter({ text: `Giveaway #${id}` });

  // Conditions purement informatives : le bot ne les vérifie pas, c'est le
  // staff qui arbitre au moment du tirage. On sépare sur « | » pour
  // permettre plusieurs lignes depuis une option de commande.
  if (conditions) {
    const lines = String(conditions)
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => `• ${c}`);

    if (lines.length > 0) {
      embed.addFields({
        name: '🎯 Conditions de participation',
        value: lines.join('\n').slice(0, 1024),
      });
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`giveaway:enter:${id}`)
      .setLabel(ended ? 'Terminé' : 'Participer')
      .setEmoji('🎉')
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended),
  );

  return { embeds: [embed], components: [row] };
}

/** Embed + boutons d'inscription d'un tournoi. */
export function buildTournamentMessage({
  id, name, description, format, maxTeams, startsAt, signups, status,
}) {
  const closed = status !== 'open';
  const full = maxTeams != null && signups.length >= maxTeams;
  const ts = Math.floor(new Date(startsAt).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.info : COLORS.primary)
    .setTitle(`🏆 ${name}`)
    .addFields(
      { name: 'Format', value: format, inline: true },
      {
        name: 'Inscrits',
        value: `${signups.length}${maxTeams ? `/${maxTeams}` : ''}`,
        inline: true,
      },
      { name: 'Début', value: `<t:${ts}:F>\n<t:${ts}:R>`, inline: true },
    )
    .setFooter({ text: `Tournoi #${id}` });

  if (description) embed.setDescription(description);

  if (signups.length > 0) {
    // Discord coupe les champs à 1024 caractères : on tronque proprement.
    const list = signups.map((uid) => `<@${uid}>`).join(', ');
    embed.addFields({
      name: 'Participants',
      value: list.length > 1000 ? `${list.slice(0, 1000)}…` : list,
    });
  }

  if (closed) embed.addFields({ name: '​', value: '🔒 **Inscriptions clôturées.**' });
  else if (full) embed.addFields({ name: '​', value: '✅ **Complet !**' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`tournoi:join:${id}`)
      .setLabel(full ? 'Complet' : 'S\'inscrire')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed || full),
    new ButtonBuilder()
      .setCustomId(`tournoi:leave:${id}`)
      .setLabel('Se désinscrire')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
  );

  return { embeds: [embed], components: [row] };
}

/** Embed + boutons d'une annonce de recherche de mates. */
export function buildLfgMessage({ id, author, mode, rank, slots, note, joined, closed }) {
  // `slots` est l'effectif TOTAL de l'équipe, créateur compris : demander
  // 5 pour du 5v5 doit donner une équipe de 5, pas de 6.
  const team = joined.length + 1;
  const remaining = Math.max(0, slots - team);
  const full = remaining === 0;

  const embed = new EmbedBuilder()
    .setColor(closed ? COLORS.info : full ? COLORS.warning : COLORS.success)
    .setAuthor({
      name: `${author.displayName ?? author.username} cherche des mates`,
      iconURL: author.displayAvatarURL(),
    })
    .setTitle(`🎮 ${mode}`)
    .addFields(
      {
        name: 'Équipe',
        value: closed ? '—' : `${team}/${slots}` + (full ? '' : ` · ${remaining} place(s)`),
        inline: true,
      },
      { name: 'Rang', value: rank || 'Peu importe', inline: true },
    )
    .setFooter({ text: `Annonce #${id}` })
    .setTimestamp();

  if (note) embed.addFields({ name: 'Précisions', value: note });

  // Le créateur fait partie de l'équipe : l'afficher évite de croire
  // qu'une place est libre alors qu'il l'occupe déjà.
  embed.addFields({
    name: 'Composition',
    value: [
      `👑 <@${author.id}>`,
      ...joined.map((uid) => `▫️ <@${uid}>`),
    ].join('\n'),
  });

  if (closed) {
    embed.setDescription('🔒 **Annonce fermée.**');
  } else if (full) {
    embed.setDescription('✅ **Équipe complète !**');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lfg:join:${id}`)
      .setLabel(full ? 'Complet' : 'Rejoindre')
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Success)
      .setDisabled(closed || full),
    new ButtonBuilder()
      .setCustomId(`lfg:leave:${id}`)
      .setLabel('Quitter')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closed),
    new ButtonBuilder()
      .setCustomId(`lfg:close:${id}`)
      .setLabel('Fermer')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closed),
  );

  return { embeds: [embed], components: [row] };
}
