# 🎮 CarréBot

Bot Discord de communauté gaming (CS2/CSGO) : vérification anti-bot, règlement obligatoire, protection anti-raid, recherche de mates, tournois et giveaways.

---

## Ce que fait le bot

### 🔐 Vérification à l'arrivée (2 étapes)

1. **Défi anti-bot** — un des trois types tirés au hasard :
   - reconnaissance de **couleur** (carré pivoté sur fond bruité),
   - lecture d'un **code** de 5 caractères déformés,
   - petit **calcul** (sans image, résiste à l'OCR).

   3 tentatives, réponse stockée côté serveur, 4 propositions par défi.

2. **Règlement** — affiché seulement après le défi réussi. Le rôle `✅ Vérifié`
   (celui qui ouvre les salons) n'est attribué **qu'après acceptation**.

Un membre qui n'a pas fait les deux étapes ne voit rien d'autre que `#🔐-verification`.

### 🛡️ Anti-raid

- **Comptes récents** : alerte dans les logs, expulsion automatique si un lockdown est actif.
- **Vagues d'arrivées** : N arrivées en X secondes → **lockdown automatique**.
- Pendant un lockdown, les vérifications sont **gelées** : le raid reste bloqué à la porte.
- `/lockdown salons` coupe l'écriture partout en une commande.

### 🎮 Communauté

- `/lfg` — annonce de recherche de mates (mode, rang, places, note libre), avec boutons Rejoindre/Quitter/Fermer et **MP automatique à l'auteur** quand quelqu'un rejoint.

### 🏆 Administration

- `/tournoi` — création, inscriptions par bouton, liste des participants, clôture.
- `/giveaway` — lancement avec durée, tirage automatique à l'échéance, `relancer` pour retirer au sort.
- `/mod` — warn, mute, kick, ban, purge, avec contrôle de hiérarchie des rôles et logs.

---

## Installation

### 1. Créer l'application Discord

1. Va sur le [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Onglet **Bot** → **Reset Token** → copie le token.
3. Toujours dans **Bot**, active les **Privileged Gateway Intents** :
   - ✅ **SERVER MEMBERS INTENT** (obligatoire — sans lui, le bot ne voit pas les arrivées)
4. Onglet **OAuth2 → URL Generator** :
   - Scopes : `bot` + `applications.commands`
   - Permissions : `Administrator` (le plus simple), ou au minimum :
     Gérer les rôles, Gérer les salons, Expulser, Bannir, Exclure temporairement,
     Gérer les messages, Lire/Envoyer des messages, Intégrer des liens, Joindre des fichiers.
5. Ouvre l'URL générée et invite le bot sur ton serveur.

### 2. Déployer sur Railway

1. Pousse ce dossier sur un dépôt GitHub.
2. Sur [Railway](https://railway.app) : **New Project → Deploy from GitHub repo**.
3. **Ajoute une base de données** : bouton **New → Database → Add PostgreSQL**.
4. Dans le service du bot, onglet **Variables**, ajoute :

   | Variable | Valeur |
   |---|---|
   | `DISCORD_TOKEN` | ton token |
   | `CLIENT_ID` | l'Application ID |
   | `GUILD_ID` | l'ID de ton serveur |
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

   > `${{Postgres.DATABASE_URL}}` est une **référence** Railway : tape-la telle quelle,
   > Railway la remplace par l'URL réelle de ta base.

5. Le bot démarre et crée ses tables tout seul.

### 3. Enregistrer les commandes slash

À faire **une fois**, et à refaire à chaque modification d'une commande.

Depuis ton PC (avec un `.env` rempli) :

```bash
npm install
npm run deploy
```

Ou depuis Railway : onglet du service → **Settings → Deploy → Custom Start Command**,
lance temporairement `npm run deploy`, puis remets `npm start`.

> Avec `GUILD_ID` : commandes disponibles **immédiatement** sur ton serveur.
> Sans `GUILD_ID` : déploiement global, propagé par Discord en ~1 heure.

### 4. Configurer le serveur

Dans Discord, en tant qu'administrateur :

```
/setup auto
```

Cette commande fait tout :
- crée le rôle `✅ Vérifié` et les salons `#🔐-verification`, `#📜-reglement`, `#📋-logs-carrebot`, `#🎮-recherche-mates`,
- **verrouille tous les autres salons** derrière la vérification,
- publie le panneau de vérification.

> ⚠️ **Point crucial** : dans **Paramètres du serveur → Rôles**, le rôle du bot doit être
> **au-dessus** du rôle `✅ Vérifié`. Sinon Discord refuse au bot de l'attribuer.
> Le bot te prévient s'il détecte ce problème.

Vérifie ensuite avec `/setup voir`.

---

## Développement local

```bash
cp .env.example .env    # puis remplis-le
npm install
npm run deploy          # une fois
npm start               # ou: npm run dev (rechargement auto)
```

Il te faut un PostgreSQL local, ou colle simplement l'URL publique de ta base Railway
dans `DATABASE_URL` (onglet Postgres → **Connect → Public Network**).

---

## Commandes

### Membres
| Commande | Rôle |
|---|---|
| `/lfg` | Chercher des mates (mode, rang, places, note) |
| `/tournoi liste` | Voir les tournois ouverts |
| `/aide` | Liste des commandes |

### Configuration — *Administrateur*
| Commande | Rôle |
|---|---|
| `/setup auto` | Configuration complète automatique |
| `/setup salons` | Définir les salons manuellement |
| `/setup roles` | Définir les rôles |
| `/setup panneau` | Republier le panneau de vérification |
| `/setup règlement` | Modifier le texte du règlement |
| `/setup antiraid` | Régler seuils et âge minimum des comptes |
| `/setup voir` | Afficher la configuration |

### Protection — *Gérer le serveur*
| Commande | Rôle |
|---|---|
| `/lockdown on` / `off` | Mode urgence anti-raid |
| `/lockdown salons` | Verrouiller/déverrouiller l'écriture partout |
| `/lockdown statut` | État de la protection |

### Modération — *Exclure des membres*
| Commande | Rôle |
|---|---|
| `/mod warn` · `warns` · `unwarn` | Avertissements |
| `/mod mute` · `unmute` | Exclusion temporaire (max 28j) |
| `/mod kick` · `ban` | Expulsion / bannissement |
| `/mod purge` | Suppression en masse (max 100, <14 jours) |

### Événements — *Gérer les événements*
| Commande | Rôle |
|---|---|
| `/tournoi créer` · `participants` · `fermer` | Tournois |
| `/giveaway lancer` · `terminer` · `relancer` | Giveaways |

**Format des durées** : `30m`, `2h`, `3d`, `1w`, ou composé (`1d6h`, `2h30m`).

---

## Réglages anti-raid

Valeurs par défaut, modifiables avec `/setup antiraid` :

| Réglage | Défaut | Effet |
|---|---|---|
| `arrivées` | 5 | Nombre d'arrivées déclenchant le lockdown |
| `fenêtre` | 10 s | Fenêtre de mesure |
| `âge_min` | 7 jours | En-dessous : alerte, et expulsion si lockdown actif |

Sur un serveur en pleine croissance, monte le seuil (ex. `10` arrivées / `10s`)
pour éviter les lockdowns pendant une vague d'arrivées légitime.

---

## Résolution de problèmes

| Symptôme | Cause | Solution |
|---|---|---|
| « Impossible de t'attribuer le rôle » | Rôle du bot trop bas | Monte le rôle du bot au-dessus de `✅ Vérifié` |
| Les commandes n'apparaissent pas | Commandes non enregistrées | `npm run deploy`, puis Ctrl+R dans Discord |
| Le bot ne réagit pas aux arrivées | Intent manquant | Active **SERVER MEMBERS INTENT** dans le portail |
| Tout est perdu après un redéploiement | Pas de base Postgres | Vérifie que `DATABASE_URL` pointe vers `${{Postgres.DATABASE_URL}}` |
| `ENOTFOUND postgres.railway.internal` | DNS privé Railway pas encore prêt | Le bot réessaie ~30 s tout seul. Si l'erreur persiste, le service Postgres n'est pas dans **le même projet** Railway que le bot — le réseau privé ne traverse pas les projets. |
| Les nouveaux voient tous les salons | Salons non verrouillés | Relance `/setup auto`, ou ferme les salons à `@everyone` |

---

## Structure

```
src/
├─ index.js              Point d'entrée, chargement dynamique
├─ deploy-commands.js    Enregistrement des commandes slash
├─ commands/
│  ├─ admin/             setup, mod, lockdown, tournoi, giveaway
│  └─ public/            lfg, aide
├─ events/               ready, guildMemberAdd, interactionCreate
├─ handlers/             verification, antiraid, lfg, tournoi, giveaway, logs
├─ lib/                  config, logger, captcha, time
└─ db/                   schéma PostgreSQL + accès
```

Les boutons suivent la convention `domaine:action:argument`, routés dans
[interactionCreate.js](src/events/interactionCreate.js).
