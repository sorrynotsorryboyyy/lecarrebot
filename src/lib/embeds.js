import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { COLORS } from './config.js';
import { buildPublication } from './publication.js';

/**
 * Constructeurs de messages partagés entre les commandes (qui publient) et
 * les handlers (qui mettent à jour). Les isoler ici évite un cycle d'imports
 * commande ↔ handler, qui obligeait à des `await import()` fragiles.
 *
 * Chacun renvoie `{ publication, components }` :
 *   • `publication` décrit le contenu (titre, corps, bannière, couleur) ;
 *   • `components` porte les boutons d'interaction.
 *
 * `toMessage()` assemble les deux en message Components V2 prêt à envoyer.
 * Cette séparation permet d'injecter une mention ou une bannière au moment
 * de l'envoi sans que les constructeurs aient à s'en préoccuper.
 */

/** Assemble un `{ publication, components }` en message envoyable. */
export function toMessage(built) {
  return buildPublication(built.publication, { components: built.components });
}

/** Horodatage Discord (secondes). */
function stamp(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

/** Publication + bouton de participation d'un giveaway. */
export function buildGiveawayMessage({
  id, prize, winners, endsAt, entries, ended,
  vipOnly = false, conditions = null, imageUrl = null,
}) {
  const ts = stamp(endsAt);

  const body = ended
    ? '**Ce giveaway est terminé.**'
    : (vipOnly ? '💎 **Réservé aux membres Elite.**\n\n' : '')
      + 'Clique sur **Participer** pour tenter ta chance !\n\n'
      + `**Fin :** <t:${ts}:F> (<t:${ts}:R>)`;

  const fields = [
    { name: 'Gagnant(s)', value: String(winners) },
    { name: 'Participants', value: String(entries) },
  ];

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
      fields.push({ name: '🎯 Conditions de participation', value: lines.join('\n') });
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

  return {
    publication: {
      title: `${vipOnly ? '💎 ' : '🎁 '}${prize}`,
      body,
      fields,
      imageUrl,
      color: ended ? COLORS.info : vipOnly ? 0x00d4ff : COLORS.warning,
      footer: `Giveaway #${id}`,
    },
    components: [row],
  };
}

/** Publication + boutons d'inscription d'un tournoi. */
export function buildTournamentMessage({
  id, name, description, format, maxTeams, startsAt, signups, status,
  imageUrl = null, publicSignupsAt = null,
}) {
  const closed = status !== 'open';
  const full = maxTeams != null && signups.length >= maxTeams;
  const ts = stamp(startsAt);

  const lines = [];
  if (description) lines.push(description);

  // Fenêtre réservée aux Elite encore ouverte : on l'annonce, sinon les
  // autres membres cliqueraient sans comprendre le refus.
  const eliteWindow = publicSignupsAt && new Date(publicSignupsAt) > new Date();
  if (eliteWindow && !closed) {
    lines.push(
      `\n💎 **Accès anticipé Elite** — ouverture à tous <t:${stamp(publicSignupsAt)}:R>.`,
    );
  }

  if (closed) lines.push('\n🔒 **Inscriptions clôturées.**');
  else if (full) lines.push('\n✅ **Complet !**');

  const fields = [
    { name: 'Format', value: format },
    { name: 'Inscrits', value: `${signups.length}${maxTeams ? `/${maxTeams}` : ''}` },
    { name: 'Début', value: `<t:${ts}:F> · <t:${ts}:R>` },
  ];

  if (signups.length > 0) {
    // Le rendu tronque à 400 caractères par champ : on coupe avant pour que
    // la liste se termine sur un nom entier plutôt qu'au milieu d'un ID.
    const list = signups.map((uid) => `<@${uid}>`).join(', ');
    fields.push({
      name: 'Participants',
      value: list.length > 380 ? `${list.slice(0, 380)}…` : list,
    });
  }

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

  return {
    publication: {
      title: `🏆 ${name}`,
      body: lines.join('\n'),
      fields,
      imageUrl,
      color: closed ? COLORS.info : COLORS.primary,
      footer: `Tournoi #${id}`,
    },
    components: [row],
  };
}

/** Publication + boutons d'une annonce de recherche de mates. */
export function buildLfgMessage({
  id, author, mode, rank, slots, note, joined, closed,
}) {
  // `slots` est l'effectif TOTAL de l'équipe, créateur compris : demander
  // 5 pour du 5v5 doit donner une équipe de 5, pas de 6.
  const team = joined.length + 1;
  const remaining = Math.max(0, slots - team);
  const full = remaining === 0;

  const lines = [`**${author.displayName ?? author.username}** cherche des mates`];

  if (closed) lines.push('\n🔒 **Annonce fermée.**');
  else if (full) lines.push('\n✅ **Équipe complète !**');

  const fields = [
    {
      name: 'Équipe',
      value: closed ? '—' : `${team}/${slots}` + (full ? '' : ` · ${remaining} place(s)`),
    },
    { name: 'Rang recherché', value: rank || 'Peu importe' },
  ];

  if (note) fields.push({ name: 'Précisions', value: note });

  // Le créateur fait partie de l'équipe : l'afficher évite de croire
  // qu'une place est libre alors qu'il l'occupe déjà.
  fields.push({
    name: 'Composition',
    value: [
      `👑 <@${author.id}>`,
      ...joined.map((uid) => `▫️ <@${uid}>`),
    ].join('\n'),
  });

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

  return {
    publication: {
      title: `🎮 ${mode}`,
      body: lines.join('\n'),
      fields,
      color: closed ? COLORS.info : full ? COLORS.warning : COLORS.success,
      footer: `Annonce #${id}`,
    },
    components: [row],
  };
}
