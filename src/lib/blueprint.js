import { ChannelType, PermissionFlagsBits as P } from 'discord.js';

/**
 * Plan complet du serveur créé par /setup.
 *
 * Tout est décrit ici en données plutôt qu'en code : ajouter un salon ou une
 * catégorie ne demande qu'une ligne, sans toucher à la logique de création.
 *
 * Clés de permissions utilisées dans `overwrites` :
 *   everyone  — @everyone
 *   verified  — le rôle donné après vérification
 *   staff     — Modérateur + Admin (cumulés)
 *   bot       — le bot lui-même
 */

/** Rôles créés, du plus haut au plus bas dans la hiérarchie. */
export const ROLES = [
  {
    key: 'admin',
    name: '👑 Admin',
    color: 0xe74c3c,
    hoist: true,
    permissions: [P.Administrator],
  },
  {
    key: 'moderator',
    name: '🛡️ Modérateur',
    color: 0x3498db,
    hoist: true,
    permissions: [
      P.KickMembers, P.BanMembers, P.ModerateMembers,
      P.ManageMessages, P.ManageNicknames, P.ViewAuditLog,
      P.MuteMembers, P.MoveMembers,
    ],
  },
  {
    key: 'verified',
    name: '✅ Vérifié',
    color: 0x2ecc71,
    hoist: false,
    permissions: [],
  },
];

/**
 * Catégories et salons.
 * `access` résume qui voit quoi, pour éviter de répéter les overwrites :
 *   'public'    — visible par tous, y compris non vérifiés
 *   'members'   — visible seulement après vérification
 *   'staff'     — visible seulement par le staff
 */
export const CATEGORIES = [
  {
    key: 'welcome',
    name: '🚪 ARRIVÉE',
    access: 'public',
    channels: [
      {
        key: 'verify',
        name: '🔐-verification',
        topic: 'Vérifie-toi ici pour accéder au serveur',
        // Seul salon visible avant vérification : une fois vérifié, il
        // disparaît pour ne pas encombrer la liste.
        access: 'unverified-only',
        readOnly: true,
      },
      {
        key: 'rules',
        name: '📜-reglement',
        topic: 'Le règlement du serveur',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'announcements',
        name: '📢-annonces',
        topic: 'Annonces importantes du serveur',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'welcome',
        name: '👋-bienvenue',
        topic: 'Les nouveaux membres sont accueillis ici',
        access: 'members',
      },
    ],
  },
  {
    key: 'community',
    name: '💬 COMMUNAUTÉ',
    access: 'members',
    channels: [
      { key: 'general', name: '💬-general', topic: 'Discussion générale' },
      { key: 'memes', name: '😂-memes', topic: 'Vos meilleurs memes' },
      { key: 'clips', name: '🎬-clips', topic: 'Vos plus beaux frags et clips' },
      { key: 'suggestions', name: '💡-suggestions', topic: 'Propose tes idées pour le serveur' },
    ],
  },
  {
    key: 'gaming',
    name: '🎮 GAMING',
    access: 'members',
    channels: [
      {
        key: 'lfg',
        name: '🎮-recherche-mates',
        topic: 'Trouve des coéquipiers avec /lfg',
      },
      { key: 'cs2', name: '🔫-cs2', topic: 'Tout sur Counter-Strike 2' },
      { key: 'strats', name: '📊-strats-et-tips', topic: 'Stratégies, line-ups et conseils' },
      { key: 'other-games', name: '🕹️-autres-jeux', topic: 'Les autres jeux de la communauté' },
    ],
  },
  {
    key: 'events',
    name: '🏆 ÉVÉNEMENTS',
    access: 'members',
    channels: [
      {
        key: 'tournaments',
        name: '🏆-tournois',
        topic: 'Les tournois de la communauté',
        readOnly: true,
      },
      {
        key: 'giveaways',
        name: '🎁-giveaways',
        topic: 'Participe aux giveaways',
        readOnly: true,
      },
      { key: 'results', name: '📋-resultats', topic: 'Résultats des tournois', readOnly: true },
    ],
  },
  {
    key: 'voice',
    name: '🔊 VOCAUX',
    access: 'members',
    channels: [
      { key: 'voice-lobby', name: '🎧 Lobby', type: 'voice' },
      { key: 'voice-cs1', name: '🔫 CS2 — Équipe 1', type: 'voice', userLimit: 5 },
      { key: 'voice-cs2', name: '🔫 CS2 — Équipe 2', type: 'voice', userLimit: 5 },
      { key: 'voice-duo', name: '👥 Duo', type: 'voice', userLimit: 2 },
      { key: 'voice-afk', name: '💤 AFK', type: 'voice' },
    ],
  },
  {
    key: 'staff',
    name: '🛡️ STAFF',
    access: 'staff',
    channels: [
      { key: 'staff-chat', name: '🛡️-staff-chat', topic: 'Discussion du staff' },
      {
        key: 'logs',
        name: '📋-logs-carrebot',
        topic: 'Journal des actions du CarréBot',
        readOnly: true,
      },
      { key: 'staff-voice', name: '🛡️ Staff', type: 'voice' },
    ],
  },
];

/**
 * Traduit un niveau d'accès en overwrites Discord.
 * `ids` fournit les identifiants résolus : { everyone, verified, moderator, admin, bot }
 */
export function buildOverwrites(access, ids, { readOnly = false } = {}) {
  const staffAllow = [ids.moderator, ids.admin]
    .filter(Boolean)
    .map((id) => ({
      id,
      allow: [P.ViewChannel, P.SendMessages, P.Connect, P.Speak],
    }));

  // Le bot doit toujours pouvoir écrire, y compris dans les salons en
  // lecture seule (logs, annonces, panneaux).
  const botAllow = ids.bot
    ? [{
        id: ids.bot,
        allow: [P.ViewChannel, P.SendMessages, P.ManageMessages, P.EmbedLinks, P.AttachFiles],
      }]
    : [];

  const denyWrite = readOnly ? [P.SendMessages, P.CreatePublicThreads, P.CreatePrivateThreads] : [];

  switch (access) {
    case 'public':
      return [
        { id: ids.everyone, allow: [P.ViewChannel], deny: denyWrite },
        ...staffAllow, ...botAllow,
      ];

    case 'unverified-only':
      // Visible tant qu'on n'est pas vérifié, masqué ensuite.
      return [
        { id: ids.everyone, allow: [P.ViewChannel], deny: [P.SendMessages] },
        { id: ids.verified, deny: [P.ViewChannel] },
        ...staffAllow, ...botAllow,
      ];

    case 'staff':
      return [
        { id: ids.everyone, deny: [P.ViewChannel] },
        ...staffAllow, ...botAllow,
      ];

    case 'members':
    default:
      return [
        { id: ids.everyone, deny: [P.ViewChannel] },
        {
          id: ids.verified,
          allow: [P.ViewChannel, P.Connect, P.Speak],
          deny: denyWrite,
        },
        ...staffAllow, ...botAllow,
      ];
  }
}

/** Type Discord d'un salon décrit dans le plan. */
export function channelType(spec) {
  return spec.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
}

/**
 * Colonnes de `guild_config` correspondant aux salons du plan.
 * Seuls ces salons sont mémorisés en base — les autres sont décoratifs.
 */
export const CHANNEL_CONFIG_KEYS = {
  verify: 'verify_channel_id',
  rules: 'rules_channel_id',
  logs: 'logs_channel_id',
  lfg: 'lfg_channel_id',
};
