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
    // Attribué UNIQUEMENT à la main par le staff, jamais par le bot : il
    // atteste d'une vérification humaine (joueur connu, non tricheur, niveau
    // suffisant). Aucun panneau ni menu ne permet de se l'auto-attribuer.
    key: 'losange',
    name: '🔷 Losange Vérifié',
    color: 0x1f8fff,
    hoist: true,
    permissions: [],
    aliases: ['Losange', 'Losange Verifie', '🔷 Losange', 'Certifié', 'Certifie'],
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
 *   'public'          — visible par tous, y compris non vérifiés
 *   'unverified-only' — visible tant qu'on n'est pas vérifié
 *   'members'         — visible seulement après vérification
 *   'elite'           — visible seulement par les détenteurs du rôle Elite
 *   'staff'           — visible seulement par le staff
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
        key: 'welcome',
        name: '👋-bienvenue',
        topic: 'Les nouveaux membres sont accueillis ici',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'roles',
        name: '🎭-roles',
        topic: 'Choisis ton rang CS2 (Premier/Faceit) et tes rôles avec les menus',
        access: 'members',
        readOnly: true,
      },
      {
        key: 'support',
        name: '🎫-support',
        topic: 'Besoin d\'aide ? Ouvre un ticket privé avec le staff',
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
        key: 'announcements',
        name: '📢-annonces',
        topic: 'Annonces importantes du serveur',
        readOnly: true,
      },
      {
        key: 'general',
        name: '💬-general',
        topic: 'Discussion générale — GIF autorisés, images et liens non',
        // Discussion : on garde le salon lisible. Les GIF passent (réaction,
        // humour), mais ni images, ni vidéos, ni liens externes.
        mediaPolicy: 'discussion',
      },
      {
        // Anciennement deux salons (😂-memes et 🎬-clips) : la frontière
        // n'était pas assez nette pour que les membres choisissent, et la
        // politique « vidéos seules » rejetait une simple capture d'écran.
        key: 'clips',
        name: '🎬-clips-et-memes',
        topic: 'Vos plus beaux frags et vos meilleurs memes — tout est autorisé',
        mediaPolicy: 'free',
      },
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
        topic: 'Trouve des coéquipiers en un clic — et gère ton salon vocal',
      },
      {
        key: 'strats',
        name: '📊-strats-et-tips',
        topic: 'Stratégies et line-ups CS2 publiés par le staff via /strat',
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
        key: 'tournaments',
        name: '🏆-tournois',
        topic: 'Tournois de la communauté — inscris-toi avec le bouton sous l\'annonce',
        readOnly: true,
      },
      {
        key: 'giveaways',
        name: '🎁-giveaways',
        topic: 'Giveaways — clique sur le bouton pour participer, tirage automatique',
        readOnly: true,
      },
    ],
  },
  {
    // Espace privé des joueurs vérifiés à la main par le staff. Le rôle
    // n'est jamais attribué automatiquement : c'est ce qui fait toute la
    // valeur de la catégorie.
    key: 'losange',
    name: '🔷 LOSANGE',
    access: 'losange',
    channels: [
      {
        key: 'losange-chat',
        name: '🔷-discussion',
        topic: 'Salon privé des joueurs Losange Vérifié',
      },
      {
        key: 'losange-lfg',
        name: '🔷-recherche-mates',
        topic: 'Trouve des coéquipiers vérifiés — entre Losange uniquement',
      },
      // Hub vocal dédié : le rejoindre crée un salon personnel dont l'accès
      // est limité à la catégorie Losange, sans passer par le hub public.
      // Le nom DOIT différer de celui du hub public : `ensureStructure`
      // retombe sur une recherche par nom quand l'identifiant est inconnu,
      // et deux salons homonymes se voleraient mutuellement leur clé.
      { key: 'losange-voice-hub', name: '➕ Créer un salon Losange', type: 'voice', userLimit: 1 },
    ],
  },
  {
    // Projet maison présenté à la communauté. Un seul salon pour l'instant :
    // la catégorie est prête à en accueillir d'autres (bêta, retours, aide)
    // quand le produit sortira.
    key: 'klipit',
    name: '🎞️ KLIPIT',
    access: 'members',
    channels: [
      {
        key: 'klipit-soon',
        name: '🚀-a-venir',
        topic: 'KlipIt — capture de clips nouvelle génération et plateforme de partage',
        readOnly: true,
      },
    ],
  },
  {
    key: 'elite',
    name: '💎 ELITE',
    access: 'elite',
    channels: [
      {
        key: 'elite-chat',
        name: '💎-salon-elite',
        topic: 'Salon réservé aux membres Elite',
      },
      { key: 'elite-voice', name: '💎 Elite', type: 'voice' },
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
        // Porte le panneau de publication en permanence : il ne se perd
        // plus dans l'historique et tout le staff y accède au même endroit.
        key: 'staff-panel',
        name: '🛠️-panel-staff',
        topic: 'Panneau de publication — annonces, tournois, giveaways, strats',
        readOnly: true,
      },
      {
        key: 'logs',
        name: '📋-logs-carrebot',
        topic: 'Journal des actions du CarréBot',
        readOnly: true,
      },
      { key: 'staff-voice', name: '🛡️ Staff', type: 'voice' },
    ],
  },
  {
    // Catégorie volontairement vide : elle sert de parent aux salons de
    // ticket créés à la demande, et disparaît visuellement quand il n'y en a
    // aucun d'ouvert.
    key: 'tickets',
    name: '🎫 TICKETS',
    access: 'staff',
    channels: [],
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
  'other-games',                                        // 🕹️-autres-jeux
  'voice-lobby', 'voice-cs1', 'voice-cs2', 'voice-duo', // vocaux fixes
  'rules',                    // 📜-reglement — doublon de l'étape 2 de la vérification
  'vote',                     // 🗳️-vote — votes non vérifiables sans webhook
  'profile', 'commands', 'xp', // catégorie 👤 PROFIL
  'memes',                    // 😂-memes — fusionné dans 🎬-clips-et-memes
  'cs2',                      // 📰-news-cs2 — sans flux automatisé, restait vide
  'results',                  // 📋-resultats — aucun code ne l'alimentait
];

/**
 * Catégories retirées du plan.
 * Même règle que les salons : supprimées seulement si leur identifiant
 * figure en base, donc si le bot les a créées — et seulement si elles sont
 * vides, pour ne pas emporter des salons ajoutés à la main.
 */
export const RETIRED_CATEGORY_KEYS = ['profile'];

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

    case 'elite':
      // Réservé aux détenteurs du rôle Elite. `ids.elite` est fourni en plus
      // de `ids.protectedRoles` (qui contient déjà le rôle Elite pour lui
      // ouvrir les salons membres) : les deux champs coexistent pour que
      // l'accès membres reste inchangé.
      return [
        { id: ids.everyone, deny: [P.ViewChannel] },
        ...(ids.elite
          ? [{ id: ids.elite, allow: [P.ViewChannel, P.Connect, P.Speak], deny: denyWrite }]
          : []),
        ...staffAllow, ...botAllow,
      ];

    case 'losange':
      // Espace fermé : le rôle s'attribue à la main, et rien d'autre n'y
      // donne accès. Le rôle Elite ne l'ouvre pas — les deux paliers sont
      // indépendants, l'un s'achète ou se récompense, l'autre se mérite.
      return [
        { id: ids.everyone, deny: [P.ViewChannel] },
        ...(ids.losange
          ? [{ id: ids.losange, allow: [P.ViewChannel, P.Connect, P.Speak], deny: denyWrite }]
          : []),
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
      '📋 Les résultats sont publiés à la suite de chaque tournoi.',
    footer: 'Les inscriptions se font par bouton, pas par message.',
  },

  'losange-chat': {
    color: 0x1f8fff,
    title: '🔷 Espace Losange',
    description:
      'Bienvenue dans l\'espace **Losange Vérifié**.\n\n' +
      'Cette partie du serveur est réservée aux joueurs **vérifiés à la main ' +
      'par le staff** : comptes connus, jeu propre, niveau confirmé. ' +
      'Le rôle ne s\'obtient par aucun menu — il se mérite.\n\n' +
      '**Ce que tu trouves ici**\n' +
      '> 🔷 Un salon de discussion entre joueurs vérifiés\n' +
      '> 🔷 Une recherche de coéquipiers sans passer par le tout-venant\n' +
      '> 🔷 Ton propre salon vocal, réservé à l\'espace Losange\n\n' +
      '🤝 Cet espace repose sur la confiance : garde-le à ce niveau.',
    footer: 'Rôle attribué manuellement par le staff.',
  },

  'losange-lfg': {
    color: 0x1f8fff,
    title: '🔷 Recherche de mates — Losange',
    description:
      'Cherche des coéquipiers **parmi les joueurs vérifiés** uniquement.\n\n' +
      'Écris simplement ce que tu cherches : le mode, ton niveau, ' +
      'le nombre de places et l\'horaire.\n\n' +
      '> Exemple : *« Premier 15k, cherche 2 pour du sérieux ce soir 21h »*\n\n' +
      '🔊 Rejoins **➕ Créer un salon Losange** pour ouvrir ton vocal privé.',
  },

  'klipit-soon': {
    color: 0x7c5cff,
    title: '🎞️ KlipIt — bientôt disponible',
    description:
      '**KlipIt**, c\'est deux choses pensées ensemble.\n\n' +
      '**🎥 Un logiciel de capture nouvelle génération**\n' +
      '> Enregistre tes meilleures actions sans y penser et sans perdre ' +
      'd\'images. Découpe, monte et exporte ton clip en quelques secondes, ' +
      'directement après la partie.\n\n' +
      '**🌐 Une plateforme pour les partager**\n' +
      '> Ton profil, tes clips, tes abonnés. Une page perso à ton nom où ' +
      'ta communauté retrouve tout ce que tu publies — pensée pour le clip ' +
      'de jeu, pas pour la vidéo longue.\n\n' +
      '**Ce salon suivra le projet** : avancement, premières images, ' +
      'ouverture de la bêta et appels aux testeurs.',
    footer: 'Salon en lecture seule — les annonces arrivent ici.',
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
