# CarréBot — notes pour l'assistance

Bot Discord CS2. JavaScript ESM, discord.js v14, PostgreSQL sans ORM,
déployé sur Railway par simple push. Tous les textes destinés aux
utilisateurs sont en **français**, avec tutoiement.

## À vérifier avant de pousser

```bash
npm run verify     # node --check sur tout src/ + tests unitaires
```

Il n'y a **aucune intégration continue** : une erreur de syntaxe part
directement en production et laisse le service en boucle de redémarrage.

## Règles à ne pas enfreindre

**Migrations additives uniquement.** Le schéma se rejoue à chaque démarrage
(`CREATE TABLE IF NOT EXISTS` + bloc `ALTER TABLE … ADD COLUMN IF NOT
EXISTS`). Ne jamais ajouter de `DROP COLUMN` : retirer la colonne du
`CREATE TABLE` et de `UPDATABLE_FIELDS` suffit — elle survit, inerte, sans
poser de verrou.

**`/reset` ne touche jamais aux rôles.** C'est délibéré : sur un serveur
actif, les supprimer ferait perdre à chacun son rang, son identité et son
statut. `/setup` les réadopte ensuite par leur nom normalisé. La table
`invite_credits` échappe elle aussi à la purge, pour la même raison — elle
porte un acquis des membres.

**`/reset` supprime TOUS les salons**, y compris ceux créés à la main, pas
seulement ceux du bot. À ne jamais suggérer à la légère.

**`RETIRED_CHANNEL_KEYS` ne supprime que ce qui est en base.** Un salon dont
l'identifiant ne figure pas dans `channel_ids` n'a pas été créé par le bot :
il n'est jamais touché. Une suppression Discord est irréversible.

**Ne pas réintroduire de système d'XP.** La table `member_xp` existait sans
avoir jamais reçu une seule écriture ; elle a été supprimée.

## Pièges connus

**Emoji dans les composants.** Discord refuse certains symboles Unicode dans
les options de menu (`COMPONENT_INVALID_EMOJI`) — `♂️ ♀️ ⚧️` notamment — et
un seul emoji invalide fait échouer la publication du **panneau entier**.
Une fonction `isSafeEmoji` avait été écrite pour s'en prémunir : elle
rejetait `1️⃣` `4️⃣` `7️⃣` (séquences keycap) et `⚪`, soit cinq options
légitimes. Elle a été supprimée. En cas de doute, tester l'emoji plutôt que
de filtrer par plage de code points.

**Components V2.** Un message portant `MessageFlags.IsComponentsV2` ne peut
plus contenir `content` ni `embeds`. Les mentions partent donc dans un
message distinct, juste avant — une mention placée dans un `TextDisplay` ne
notifie pas de façon fiable. Limites : 4000 caractères cumulés, 40
composants, 10 rangées par conteneur.

**Deux salons ne doivent jamais porter le même nom.** `ensureStructure`
retombe sur une recherche par nom quand l'identifiant est inconnu : deux
homonymes se voleraient mutuellement leur clé. Le test
`test/blueprint.test.js` le vérifie.

**`repairOverwrites` ajoute mais ne retire jamais.** Reclasser un salon
existant de `members` vers `elite` laisserait l'ancienne entrée en place, et
le salon resterait visible de tous. Créer un nouveau salon, ou traiter le cas
explicitement.

**`showModal()` ne peut pas suivre un `defer`.** Toute interaction qui ouvre
un formulaire doit répondre directement.

**`isStale()` renvoie vrai sur une entrée absente.** Tester l'existence avant
de déclencher un rafraîchissement, sinon on interroge la base pour rien.

## Repères d'architecture

**`lib/blueprint.js` décrit le serveur en données.** Ajouter un salon ou une
catégorie ne demande qu'une ligne, sans toucher à la logique de `/setup`.

**Routage des interactions.** Convention `domaine:action[:argument]`,
découpée par `events/interactionCreate.js`. Un seul routeur, cinq
sous-routeurs selon le type de composant. Les codes 40060 (déjà acquitté) et
10062 (expirée) sont volontairement ignorés.

**La base fait foi pour tout ce qui est planifié.** Giveaways, publications
programmées, expiration des VIP : tous interrogent la base par intervalle
plutôt que d'utiliser des minuteries, qui ne survivraient pas à un
redéploiement.

**Un seul chemin de création par objet.** `lib/events.js` sert à la fois les
commandes et le panneau : c'est ce qui a corrigé les divergences d'avant
(format forcé à `5v5`, option Elite perdue).

**`ids.verified` désigne le rôle « 🎮 Membre ».** La clé interne `verified`
et la colonne `verified_role_id` ont conservé leur nom d'origine ; les
renommer imposerait une migration pour un mot que personne ne voit.

**« Elite » côté affichage, `vip_*` côté base.** Les colonnes `vip_role_id`,
la table `vip_members` et la commande `/vip` gardent leur nom. Seuls les
textes visibles disent « Elite ».

**Le rôle 🔷 Losange Vérifié s'attribue à la main.** Aucun panneau ni menu ne
permet de se l'auto-attribuer — c'est ce qui fait la valeur de son espace.
Il est indépendant d'Elite : l'un n'ouvre pas l'autre.

## Structure

```
src/
├─ index.js              Chargement dynamique des commandes et événements
├─ commands/admin|public Commandes slash (exigent `data` + `execute`)
├─ events/               Écouteurs (exigent `name` + `execute`)
├─ handlers/             Logique métier, appelée par events et commandes
├─ lib/                  Données et fonctions pures (testées)
└─ db/index.js           Schéma, migrations, accès
```

`lib/embeds.js` existe pour rompre le cycle commande ↔ handler. Ses
constructeurs renvoient `{ publication, components }` ; `toMessage()` assemble
le tout en message V2.
