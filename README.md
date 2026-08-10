# CarréBot

Bot Discord d'une communauté **Counter-Strike 2** : vérification par captcha,
anti-raid, recherche de coéquipiers, tournois, giveaways, tickets de support
et statistiques Faceit / Steam.

Écrit en JavaScript (ESM), discord.js v14, PostgreSQL, déployé sur Railway.

---

## Démarrage rapide

```bash
npm install
cp .env.example .env     # puis remplis DISCORD_TOKEN, CLIENT_ID, DATABASE_URL
npm run deploy           # enregistre les commandes auprès de Discord
npm start
```

Une fois le bot en ligne sur ton serveur, lance **`/setup`** : il crée
l'intégralité de la structure (rôles, catégories, salons, permissions) et
publie les panneaux interactifs.

### Prérequis

- **Node.js 20 ou plus**
- Une base **PostgreSQL** (Railway en fournit une en un clic)
- Les **deux intents privilégiés** activés dans le
  [Developer Portal](https://discord.com/developers/applications) →
  ton application → **Bot** → *Privileged Gateway Intents* :
  - ✅ **SERVER MEMBERS INTENT** — arrivées et attribution des rôles
  - ✅ **MESSAGE CONTENT INTENT** — politiques média

  Sans eux, le bot refuse de démarrer avec un message explicite.

### Permissions du bot

Invite-le avec au minimum : *Gérer le serveur*, *Gérer les rôles*,
*Gérer les salons*, *Expulser*, *Bannir*, *Modérer les membres*,
*Gérer les messages*, *Déplacer les membres*.

> **Important** — le rôle du bot doit se trouver **au-dessus** de tous les
> rôles qu'il attribue (Membre, rangs, identité). `/setup` le vérifie et te
> prévient si ce n'est pas le cas.

*Gérer le serveur* est indispensable au suivi « invité par X » : sans elle,
ce champ n'apparaît simplement pas.

---

## Variables d'environnement

| Variable | Requise | Rôle |
|---|:---:|---|
| `DISCORD_TOKEN` | ✅ | Token du bot |
| `CLIENT_ID` | ✅ | Identifiant de l'application |
| `DATABASE_URL` | ✅ | Connexion PostgreSQL |
| `GUILD_ID` | — | Déploiement instantané sur un seul serveur (sinon global, ~1 h) |
| `DATABASE_PUBLIC_URL` | — | Repli si le réseau privé Railway est injoignable |
| `LOG_LEVEL` | — | `debug` \| `info` \| `warn` \| `error` (défaut `info`) |
| `FACEIT_API_KEY` | — | Statistiques Faceit ([clé gratuite](https://developers.faceit.com)) |
| `STEAM_API_KEY` | — | Statistiques Steam ([clé gratuite](https://steamcommunity.com/dev/apikey)) |

Les deux dernières sont **facultatives** : sans elles, le bot fonctionne
normalement et `/lier` répond que la source n'est pas configurée.

---

## Commandes

### Pour les membres

| Commande | Description |
|---|---|
| `/aide` | Guide du serveur |
| `/profil [membre]` | Rangs, arrivée, invitations, statistiques |
| `/lier faceit\|steam\|voir\|actualiser\|delier` | Lier un compte de jeu |

### Pour le staff

| Commande | Permission | Description |
|---|---|---|
| `/setup` | Administrateur | Crée toute la structure du serveur |
| `/reset` | Propriétaire | ⚠️ Supprime **tous** les salons |
| `/config` | Gérer le serveur | Réglages du bot sans redéploiement |
| `/panel` | Gérer le serveur | Panneau de publication |
| `/vip ajouter\|retirer\|liste` | Administrateur | Gestion des membres Elite |
| `/mod warn\|warns\|unwarn\|mute\|unmute\|kick\|ban\|purge` | Modérer | Modération |
| `/lockdown on\|off\|salons\|statut` | Gérer le serveur | Verrouillage d'urgence |
| `/tournoi créer\|liste\|participants\|fermer` | Gérer les événements | Tournois |
| `/giveaway lancer\|terminer\|relancer` | Gérer les événements | Giveaways |
| `/strat` | Gérer les messages | Stratégies et line-ups |

#### `/config` en détail

| Sous-commande | Effet |
|---|---|
| `voir` | Vue d'ensemble de la configuration |
| `reglement` | Modifie le texte du règlement (formulaire) |
| `antiraid` | Seuils de détection et âge minimum des comptes |
| `salon` | Rattache un salon à une fonction du bot |
| `media` | Ce qui est autorisé dans un salon |
| `banniere` | Bannière par défaut d'un type de publication |

---

## Structure créée par `/setup`

### Rôles

| Rôle | Attribution | Rôle dans le serveur |
|---|---|---|
| 👑 **Admin** | Manuelle | Administrateur |
| 🛡️ **Modérateur** | Manuelle | Modération |
| 💎 **Elite** | `/vip ajouter` | Avantages (voir plus bas) |
| 🔷 **Losange Vérifié** | **Manuelle uniquement** | Accès à l'espace privé |
| 🎮 **Membre** | Après vérification | Accès au serveur |

S'y ajoutent **11 rangs CS2** (7 Premier, 4 Faceit) et **7 rôles d'identité**
(âge, genre, style de jeu), tous auto-attribuables depuis `#🎭-roles`.

Les rôles **Fondateur** et **Amis**, s'ils existent, sont détectés et
reçoivent l'accès aux salons membres — sans jamais être modifiés.

### Salons

| Catégorie | Accès | Salons |
|---|---|---|
| 🚪 ARRIVÉE | Public | `🔐-verification` `👋-bienvenue` `🎭-roles` `🎫-support` |
| 💬 COMMUNAUTÉ | Membres | `📢-annonces` `💬-general` `🎬-clips-et-memes` `💡-suggestions` |
| 🎮 GAMING | Membres | `🎮-recherche-mates` `📊-strats-et-tips` |
| 🏆 ÉVÉNEMENTS | Membres | `🏆-tournois` `🎁-giveaways` |
| 🔷 LOSANGE | **Losange** | `🔷-discussion` `🔷-recherche-mates` `➕ Créer un salon Losange` |
| 🎞️ KLIPIT | Membres | `🚀-a-venir` |
| 💎 ELITE | **Elite** | `💎-salon-elite` `💎 Elite` (vocal) |
| 🔊 VOCAUX | Membres | `➕ Créer un salon` `💤 AFK` |
| 🛡️ STAFF | Staff | `🛡️-staff-chat` `🛠️-panel-staff` `📋-logs-carrebot` `🛡️ Staff` |
| 🎫 TICKETS | Staff | *(parent des tickets ouverts)* |

`/setup` est **idempotent** : relançable sans risque. Il adopte les salons et
rôles existants (par identifiant mémorisé, puis par nom), les renomme sur
place plutôt que d'en créer des doublons, et ne supprime que ce qu'il a
lui-même créé.

---

## Fonctionnement

### Vérification en deux étapes

Un arrivant ne voit que `#🔐-verification`. Il doit :

1. **Résoudre un captcha** — image de couleur, code déformé ou calcul mental,
   tiré au sort. Trois tentatives, la réponse est stockée côté serveur.
2. **Accepter le règlement** — modifiable par `/config reglement`.

Le rôle 🎮 Membre n'est accordé qu'après **les deux** étapes. Une carte de
bienvenue est alors publiée dans `#👋-bienvenue`, avec le parrain et son
nombre d'invitations.

### Anti-raid

- **Compte trop récent** (défaut : moins de 7 jours) → alerte dans les logs ;
  expulsion seulement si un lockdown est actif.
- **Vague d'arrivées** (défaut : 5 en 10 s) → lockdown automatique, qui gèle
  toutes les vérifications en cours.

Réglable avec `/config antiraid`.

### Recherche de coéquipiers

Un panneau à boutons dans `#🎮-recherche-mates` : un clic sur le mode, un
formulaire court, puis le choix de **qui notifier** — personne, les joueurs
de ton rang, ou un rang précis. L'annonce publiée porte les boutons
*Rejoindre* / *Quitter* / *Fermer*, et l'auteur reçoit un message privé à
chaque arrivée.

### Salons vocaux à la demande

Rejoindre `➕ Créer un salon` crée un vocal personnel et y déplace le membre.
Le panneau de gestion (renommer, limiter, verrouiller, inviter, expulser,
céder) est posté dans le chat du salon. Il disparaît dès qu'il se vide ; si
le propriétaire part, la propriété passe au plus ancien présent.

L'espace Losange a **son propre générateur**, dont les salons héritent de ses
permissions.

### Politiques média

| Salon | Autorisé |
|---|---|
| `#💬-general` | GIF seulement |
| `#🎬-clips-et-memes` | Tout |

Le contrôle croise l'extension **et** le type MIME : un `.png` renommé `.gif`
ne passe pas. Le staff et les membres **Elite** ne sont jamais filtrés.
Modifiable par salon avec `/config media`.

### Publications

Le panneau permanent de `#🛠️-panel-staff` publie annonces, news, tournois,
giveaways et stratégies. Le formulaire recueille l'essentiel, puis un
**aperçu** — le rendu réel — permet d'ajouter :

- une **image en bannière**, affichée au-dessus du titre ;
- un **bouton de lien**, une **couleur**, des **champs libres** ;
- une **mention** ciblée (@everyone, @here, ou aucune) ;
- une **publication programmée**, qui survit aux redémarrages.

Les brouillons sont enregistrés en base : un redéploiement ne fait rien
perdre.

### Tickets

Le bouton de `#🎫-support` ouvre un salon privé entre le membre et le staff,
rangé sous 🎫 TICKETS. Un seul ticket ouvert par membre. À la fermeture, la
conversation est transcrite dans un fichier joint au journal, puis le salon
est supprimé.

### Statistiques CS2

`/lier faceit` et `/lier steam` rattachent un compte au profil.

- **Faceit** : niveau, Elo, K/D, winrate.
- **Steam** : heures de jeu, kills, victoires. Le profil doit avoir
  « Détails du jeu » en **public**.

Les données sont **mises en cache 6 heures**. `/profil` lit toujours le
cache — jamais l'API — et déclenche un rafraîchissement en arrière-plan
quand il a vieilli.

> Valve n'expose aucune API publique pour la cote **Premier** : elle reste
> déclarative, via les menus de `#🎭-roles`.

### Avantages Elite

| Avantage | Détail |
|---|---|
| Salons dédiés | Catégorie 💎 ELITE, texte et vocal |
| Vocaux | Limite jusqu'à 99 places au lieu de 10 |
| Giveaways | Chances **doublées** au tirage (annoncé publiquement) |
| Tournois | Accès anticipé aux inscriptions (`elite_avant`) |
| Média | Exempté des restrictions, comme le staff |

### Invitations

Le bot photographie les compteurs d'invitation et les compare à chaque
arrivée : celle dont le compteur a bougé désigne le parrain. Le résultat
apparaît dans la carte de bienvenue et dans `/profil`.

Si deux personnes arrivent dans le même intervalle, l'origine est
indécidable — le champ est alors omis plutôt qu'attribué au hasard.

---

## Développement

```bash
npm run dev        # démarrage avec rechargement automatique
npm run check      # contrôle syntaxique de tous les fichiers
npm test           # tests unitaires (fonctions pures)
npm run verify     # les deux — à lancer avant chaque push
```

Le bot est déployé par simple push, **sans intégration continue** : une
erreur de syntaxe part directement en production. `npm run verify` est le
garde-fou.

### Organisation

```
src/
├─ index.js              Point d'entrée, chargement dynamique
├─ deploy-commands.js    Enregistrement des commandes
├─ commands/
│  ├─ admin/             Commandes du staff
│  └─ public/            Commandes des membres
├─ events/               Écouteurs Discord
├─ handlers/             Logique métier
├─ lib/                  Données et fonctions pures
└─ db/                   Schéma et accès PostgreSQL
```

**Conventions**

- Les `customId` suivent `domaine:action[:argument]`, découpés par le
  routeur unique de `events/interactionCreate.js`.
- `lib/blueprint.js` décrit le serveur en **données** : ajouter un salon ne
  demande qu'une ligne.
- Les tâches planifiées interrogent la base plutôt que d'utiliser des
  minuteries : elles survivent aux redéploiements.
- Le schéma se crée et se migre au démarrage, de façon idempotente.

---

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `disallowed intents` au démarrage | Les deux intents privilégiés ne sont pas activés |
| Les rôles ne s'attribuent pas | Le rôle du bot est trop bas dans la hiérarchie |
| Le panneau des rôles est incomplet | Un rôle a été supprimé à la main — relance `/setup` |
| « Invité par » n'apparaît jamais | Permission *Gérer le serveur* manquante |
| `ENOTFOUND *.railway.internal` | Base dans un autre projet — utilise `DATABASE_PUBLIC_URL` |
| Les stats Steam sont vides | Profil privé : passe « Détails du jeu » en public |
| Une commande n'apparaît pas | Relance `npm run deploy` |

`/setup` produit un rapport détaillé : rôles adoptés, salons créés ou
renommés, références nettoyées et avertissements. **Lis-le en entier** après
chaque exécution.
