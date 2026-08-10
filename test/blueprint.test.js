import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PermissionFlagsBits as P } from 'discord.js';
import {
  CATEGORIES,
  CHANNEL_CONFIG_KEYS,
  CHANNEL_INTROS,
  RETIRED_CATEGORY_KEYS,
  RETIRED_CHANNEL_KEYS,
  ROLES,
  buildOverwrites,
} from '../src/lib/blueprint.js';

/**
 * Le plan du serveur est une donnée : une incohérence n'y provoque aucune
 * erreur de syntaxe, elle se voit seulement après un /setup sur un vrai
 * serveur. Ces contrôles la rattrapent avant.
 */

const IDS = {
  everyone: 'EVERYONE',
  verified: 'VERIFIED',
  moderator: 'MOD',
  admin: 'ADMIN',
  bot: 'BOT',
  elite: 'ELITE',
  losange: 'LOSANGE',
  protectedRoles: ['FOUNDER', 'ELITE'],
};

const allChannels = () => CATEGORIES.flatMap((c) => c.channels);
const idsOf = (access, options) => buildOverwrites(access, IDS, options).map((o) => o.id);

describe('cohérence du plan', () => {
  it('n\'a pas deux salons de même clé', () => {
    const keys = allChannels().map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('n\'a pas deux salons de même nom', () => {
    // `ensureStructure` retombe sur une recherche par nom quand
    // l'identifiant est inconnu : deux homonymes se voleraient leur clé.
    const names = allChannels().map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
  });

  it('n\'a pas deux catégories de même clé ni de même nom', () => {
    const keys = CATEGORIES.map((c) => c.key);
    const names = CATEGORIES.map((c) => c.name);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(new Set(names).size, names.length);
  });

  it('n\'a pas deux rôles de même clé', () => {
    const keys = ROLES.map((r) => r.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it('ne retire pas un salon encore au plan', () => {
    // Une clé présente dans les deux listes serait créée puis supprimée
    // à chaque /setup.
    const keys = new Set(allChannels().map((c) => c.key));
    for (const retired of RETIRED_CHANNEL_KEYS) {
      assert.equal(keys.has(retired), false, `${retired} est retiré ET au plan`);
    }
  });

  it('ne retire pas une catégorie encore au plan', () => {
    const keys = new Set(CATEGORIES.map((c) => c.key));
    for (const retired of RETIRED_CATEGORY_KEYS) {
      assert.equal(keys.has(retired), false, `${retired} est retirée ET au plan`);
    }
  });

  it('ne définit pas d\'intro orpheline', () => {
    // Une intro dont le salon n'existe plus ne serait jamais publiée.
    const keys = new Set(allChannels().map((c) => c.key));
    for (const key of Object.keys(CHANNEL_INTROS)) {
      assert.equal(keys.has(key), true, `intro « ${key} » sans salon`);
    }
  });

  it('ne mappe que des salons existants vers une colonne', () => {
    const keys = new Set(allChannels().map((c) => c.key));
    for (const key of Object.keys(CHANNEL_CONFIG_KEYS)) {
      assert.equal(keys.has(key), true, `CHANNEL_CONFIG_KEYS.${key} sans salon`);
    }
  });

  it('gère tous les niveaux d\'accès utilisés', () => {
    const levels = new Set();
    for (const cat of CATEGORIES) {
      levels.add(cat.access);
      for (const ch of cat.channels) if (ch.access) levels.add(ch.access);
    }

    for (const level of levels) {
      assert.ok(buildOverwrites(level, IDS).length > 0, `accès « ${level} » non géré`);
    }
  });
});

describe('buildOverwrites', () => {
  it('ferme les salons membres à @everyone', () => {
    const entry = buildOverwrites('members', IDS).find((o) => o.id === IDS.everyone);
    assert.ok(entry.deny.includes(P.ViewChannel));
  });

  it('ouvre les salons membres au rôle vérifié', () => {
    assert.ok(idsOf('members').includes(IDS.verified));
  });

  it('réserve les salons elite au seul rôle Elite', () => {
    const ids = idsOf('elite');
    assert.ok(ids.includes(IDS.elite));
    // Le rôle membre ne doit PAS y figurer, sinon le salon serait visible
    // de tout le serveur.
    assert.equal(ids.includes(IDS.verified), false);
  });

  it('réserve les salons losange au seul rôle Losange', () => {
    const ids = idsOf('losange');
    assert.ok(ids.includes(IDS.losange));
    assert.equal(ids.includes(IDS.verified), false);
    // Les deux paliers sont indépendants : être Elite n'ouvre pas Losange.
    assert.equal(ids.includes(IDS.elite), false);
  });

  it('n\'émet pas d\'entrée quand le rôle n\'est pas résolu', () => {
    // Un `undefined` dans la liste ferait échouer la création du salon.
    const ids = idsOf('elite', {});
    assert.equal(buildOverwrites('elite', { ...IDS, elite: null }).some((o) => !o.id), false);
    assert.ok(ids.length > 0);
  });

  it('laisse toujours le bot écrire, même en lecture seule', () => {
    // Sans cela, le bot ne pourrait pas publier ses propres panneaux dans
    // les salons qu'il verrouille.
    const bot = buildOverwrites('members', IDS, { readOnly: true })
      .find((o) => o.id === IDS.bot);

    assert.ok(bot.allow.includes(P.SendMessages));
  });

  it('interdit d\'écrire dans un salon en lecture seule', () => {
    const entry = buildOverwrites('members', IDS, { readOnly: true })
      .find((o) => o.id === IDS.verified);

    assert.ok(entry.deny.includes(P.SendMessages));
  });

  it('masque le salon de vérification aux membres vérifiés', () => {
    const entry = buildOverwrites('unverified-only', IDS)
      .find((o) => o.id === IDS.verified);

    assert.ok(entry.deny.includes(P.ViewChannel));
  });
});
