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
    key: 'vip',
    name: '💎 Elite',
    color: 0x00d4ff,
    hoist: true,
    permissions: [],
    aliases: ['VIP', 'Elite (VIP)', '💎 Elite (VIP)', 'Premium'],
  },
  {
    key: 'verified',
    name: '🎮 Membre',
    color: 0x2ecc71,
    hoist: false,
    permissions: [],
    // Anciens noms du même rôle : /setup les adopte et les renomme au lieu
    // d'en créer un nouveau, ce qui préserverait l'accès des membres déjà
    // vérifiés. La clé `verified` reste inchangée en base.
    aliases: ['✅ Vérifié', 'Vérifié', 'Verifie', 'Membre'],
  },
];

/**
 * Rôles appartenant à l'administrateur du serveur, jamais créés ni modifiés
 * par le bot. On se contente de les détecter pour leur donner accès aux
 * salons membres — leur couleur, leurs permissions et leur position
 * restent entièrement sous votre contrôle.
 */
export const PROTECTED_ROLES = [
  { key: 'founder', names: ['Fondateur', 'Fondatrice', 'Founder', 'Owner'] },
  { key: 'friends', names: ['Amis', 'Ami', 'Friends', 'Amis du serveur'] },
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
        topic: 'Le règlement à accepter pour devenir membre',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'welcome',
        name: '👋-bienvenue',
        topic: 'Les nouveaux membres sont accueillis ici',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'roles',
        name: '🎭-roles',
        topic: 'Choisis ton rang CS2 et tes rôles avec les menus',
        access: 'members',
        readOnly: true,
      },
    ],
  },
  {
    key: 'community',
    name: '💬 COMMUNAUTÉ',
    access: 'members',
    channels: [
      {
        key: 'general',
        name: '💬-general',
        topic: 'Discussion générale — GIF autorisés, images et liens non',
        // Discussion : on garde le salon lisible. Les GIF passent (réaction,
        // humour), mais ni images, ni vidéos, ni liens externes.
        mediaPolicy: 'discussion',
      },
      {
        key: 'memes',
        name: '😂-memes',
        topic: 'Vos meilleurs memes — tout est autorisé',
        mediaPolicy: 'free',
      },
      {
        key: 'clips',
        name: '🎬-clips',
        topic: 'Vos plus beaux frags — liens et vidéos uniquement',
        mediaPolicy: 'clips',
      },
      { key: 'suggestions', name: '💡-suggestions', topic: 'Propose tes idées pour le serveur' },
      {
        key: 'vote',
        name: '🗳️-vote',
        topic: 'Vote pour le serveur et gagne des récompenses',
        readOnly: true,
      },
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
        topic: 'Trouve des coéquipiers avec /recherche',
      },
      {
        key: 'cs2',
        name: '📰-news-cs2',
        topic: 'Actualités et mises à jour de Counter-Strike 2',
        readOnly: true,
      },
      {
        key: 'strats',
        name: '📊-strats-et-tips',
        topic: 'Stratégies, line-ups et conseils publiés par le staff',
        readOnly: true,
      },
    ],
  },
  {
    key: 'events',
    name: '🏆 ÉVÉNEMENTS',
    access: 'members',
    channels: [
      {
        key: 'announcements',
        name: '📢-annonces',
        topic: 'Annonces importantes du serveur',
        readOnly: true,
      },
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
    key: 'profile',
    name: '👤 PROFIL',
    access: 'members',
    channels: [
      {
        key: 'profile',
        name: '📇-profil',
        topic: 'Consulte ton profil et ta progression',
        readOnly: true,
      },
      {
        key: 'commands',
        name: '🤖-commandes',
        topic: 'Utilise les commandes du bot ici',
      },
      {
        key: 'xp',
        name: '📊-xp',
        topic: 'Montées de niveau et classement',
        readOnly: true,
      },
    ],
  },
  {
    key: 'voice',
    name: '🔊 VOCAUX',
    access: 'members',
    channels: [
      // Salon « générateur » : le rejoindre crée un vocal personnel et y
      // déplace le membre. Il reste vide en permanence.
      { key: 'voice-hub', name: '➕ Créer un salon', type: 'voice', userLimit: 1 },
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
 * Salons retirés du plan lors d'une refonte.
 *
 * `/setup` les supprime — mais UNIQUEMENT si leur identifiant figure en
 * base, c'est-à-dire s'il les a lui-même créés. Un salon du même nom créé
 * à la main n'est jamais touché : une suppression Discord est
 * irréversible et emporte tout l'historique.
 */
export const RETIRED_CHANNEL_KEYS = [
  'other-games',                                  // 🕹️-autres-jeux
  'voice-lobby', 'voice-cs1', 'voice-cs2', 'voice-duo', // vocaux fixes
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

  // Fondateur, Amis… : rôles vous appartenant, détectés puis autorisés sur
  // les salons membres. Ils sont traités comme des membres vérifiés, sans
  // qu'aucune de leurs propriétés ne soit modifiée.
  const protectedAllow = (ids.protectedRoles ?? [])
    .filter(Boolean)
    .map((id) => ({
      id,
      allow: [P.ViewChannel, P.Connect, P.Speak],
      deny: readOnly ? [P.SendMessages] : [],
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
        ...protectedAllow, ...staffAllow, ...botAllow,
      ];
  }
}

/** Type Discord d'un salon décrit dans le plan. */
export function channelType(spec) {
  return spec.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
}

/**
 * Embeds de présentation postés dans les salons en lecture seule.
 *
 * Un embed sans `color` s'affiche avec une barre latérale grise/blanche :
 * chaque entrée définit donc explicitement sa couleur.
 *
 * Clé = `key` du salon dans le plan ci-dessus.
 */
export const CHANNEL_INTROS = {
  announcements: {
    color: 0xe67e22,
    title: '📢 Annonces',
    description:
      'Ce salon contient les **annonces officielles** du serveur.\n\n' +
      'Mises à jour, événements à venir, changements de règlement : ' +
      'tout ce qu\'il faut savoir est publié ici.\n\n' +
      '🔔 Active les notifications pour ne rien manquer.',
    footer: 'Seul le staff peut écrire ici.',
  },

  welcome: {
    color: 0x2ecc71,
    title: '👋 Bienvenue !',
    description:
      'Ce salon accueille les **nouveaux membres** de la communauté.\n\n' +
      'Tu viens d\'arriver ? Présente-toi : ton pseudo en jeu, ton rang, ' +
      'tes horaires de jeu habituels.\n\n' +
      'Bon jeu et bienvenue parmi nous ! 🎮',
  },

  tournaments: {
    color: 0xf1c40f,
    title: '🏆 Tournois',
    description:
      'Les **tournois de la communauté** sont annoncés ici.\n\n' +
      '**Comment participer ?**\n' +
      '> Clique sur le bouton **S\'inscrire** sous l\'annonce du tournoi.\n' +
      '> Tu peux te désinscrire à tout moment avant le début.\n\n' +
      '📋 Les résultats sont publiés dans le salon dédié.',
    footer: 'Les inscriptions se font par bouton, pas par message.',
  },

  giveaways: {
    color: 0xe91e63,
    title: '🎁 Giveaways',
    description:
      'Les **concours et giveaways** ont lieu dans ce salon.\n\n' +
      '**Comment participer ?**\n' +
      '> Clique sur le bouton 🎉 **Participer** sous le giveaway.\n' +
      '> Le tirage est automatique à la fin du compte à rebours.\n\n' +
      '🍀 Une seule participation par personne — bonne chance !',
    footer: 'Les gagnants sont mentionnés automatiquement.',
  },

  results: {
    color: 0x9b59b6,
    title: '📋 Résultats',
    description:
      'Les **résultats des tournois** et événements sont archivés ici.\n\n' +
      'Classements, scores et highlights des compétitions passées.',
    footer: 'Seul le staff peut écrire ici.',
  },

  // Note : le salon 🎭-roles reçoit un panneau interactif (publishRankPanel),
  // pas une simple présentation — il n'a donc pas d'entrée ici.

  logs: {
    color: 0x95a5a6,
    title: '📋 Journal du CarréBot',
    description:
      'Ce salon enregistre automatiquement les **actions du bot** :\n\n' +
      '> • Vérifications réussies et échouées\n' +
      '> • Alertes anti-raid et lockdowns\n' +
      '> • Sanctions (warn, mute, kick, ban)\n' +
      '> • Purges de messages\n\n' +
      '🔒 Salon réservé au staff.',
    footer: 'Écrit automatiquement par le bot.',
  },
};

/**
 * Colonnes de `guild_config` correspondant aux salons du plan.
 * Seuls ces salons sont mémorisés en base — les autres sont décoratifs.
 */
export const CHANNEL_CONFIG_KEYS = {
  verify: 'verify_channel_id',
  rules: 'rules_channel_id',
  logs: 'logs_channel_id',
  lfg: 'lfg_channel_id',
  welcome: 'welcome_channel_id',
  roles: 'roles_channel_id',
};

/**
 * Correspondance bit de permission → nom, nécessaire à la réparation :
 * `permissionOverwrites.edit()` attend un objet { NomDePermission: booléen },
 * alors que `buildOverwrites` produit des tableaux de bits.
 *
 * Les valeurs de PermissionFlagsBits sont des BigInt ; les clés de Map sont
 * comparées par valeur, la correspondance est donc exacte.
 */
const PERM_NAMES = new Map(Object.entries(P).map(([name, bit]) => [bit, name]));

export function permName(bit) {
  return PERM_NAMES.get(bit);
}
