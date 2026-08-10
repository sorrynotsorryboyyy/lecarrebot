import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeRankName, rankKeyForRoleName } from '../src/lib/ranks.js';
import { identityKeyForRoleName } from '../src/lib/identity.js';
import { formatDuration, parseDuration } from '../src/lib/time.js';
import { parseJsonColumn } from '../src/lib/jsonColumn.js';
import { classifyAttachment, evaluateMessage } from '../src/lib/mediaPolicy.js';

describe('normalizeRankName', () => {
  it('retire emoji, accents, espaces et tirets', () => {
    // Sans cette normalisation, /setup ne reconnaîtrait aucun rôle existant
    // et en créerait un doublon à chaque exécution.
    assert.equal(normalizeRankName('🔫 16K - 20k '), '16k20k');
    assert.equal(normalizeRankName('3K-6K'), '3k6k');
    assert.equal(normalizeRankName('20K +'), '20k+');
  });

  it('tolère les valeurs vides', () => {
    assert.equal(normalizeRankName(null), '');
    assert.equal(normalizeRankName(undefined), '');
  });
});

describe('rankKeyForRoleName', () => {
  it('reconnaît le nom canonique', () => {
    assert.equal(rankKeyForRoleName('10k-13k'), 'p4');
    assert.equal(rankKeyForRoleName('Faceit 9-10'), 'f4');
  });

  it('reconnaît un alias', () => {
    assert.equal(rankKeyForRoleName('fc78'), 'f3');
  });

  it('rattrape un préfixe libre par les chiffres', () => {
    // « Premier 10k-13k » ou « Rang 3k-6k » : la seconde passe compare les
    // seules séquences de chiffres, distinctes entre tous les paliers.
    assert.equal(rankKeyForRoleName('Premier 10k-13k'), 'p4');
    assert.equal(rankKeyForRoleName('Rang 3k-6k'), 'p2');
  });

  it('renvoie null pour un rôle quelconque', () => {
    assert.equal(rankKeyForRoleName('Modérateur'), null);
    assert.equal(rankKeyForRoleName(''), null);
  });
});

describe('identityKeyForRoleName', () => {
  it('reconnaît les noms actuels', () => {
    assert.equal(identityKeyForRoleName('👨 Homme'), 'g_h');
    assert.equal(identityKeyForRoleName('🔞 +18'), 'age18');
  });

  it('adopte les anciens noms à emoji refusé par Discord', () => {
    // ♂️ ♀️ ⚧️ faisaient échouer la publication du panneau entier : les
    // rôles déjà créés sous ces noms doivent être adoptés, pas dupliqués.
    assert.equal(identityKeyForRoleName('♂️ Homme'), 'g_h');
    assert.equal(identityKeyForRoleName('⚧️ Autre'), 'g_a');
  });
});

describe('parseDuration', () => {
  it('lit les formes simples et composées', () => {
    assert.equal(parseDuration('30m'), 30 * 60_000);
    assert.equal(parseDuration('2h'), 2 * 3_600_000);
    assert.equal(parseDuration('1d6h'), 30 * 3_600_000);
  });

  it('refuse une saisie partiellement valide', () => {
    // « demain 5h » ne doit pas être lu comme « 5h » : l'utilisateur
    // croirait avoir programmé autre chose que ce qui est pris.
    assert.equal(parseDuration('demain 5h'), null);
    assert.equal(parseDuration('5'), null);
    assert.equal(parseDuration(''), null);
    assert.equal(parseDuration('0m'), null);
  });
});

describe('formatDuration', () => {
  it('formate en français', () => {
    assert.equal(formatDuration(90 * 60_000), '1h 30m');
    assert.equal(formatDuration(0), 'terminé');
    assert.equal(formatDuration(-1), 'terminé');
  });
});

describe('parseJsonColumn', () => {
  it('accepte un objet, une chaîne, ou rien', () => {
    assert.deepEqual(parseJsonColumn({ a: 1 }), { a: 1 });
    assert.deepEqual(parseJsonColumn('{"a":1}'), { a: 1 });
    assert.deepEqual(parseJsonColumn(null), {});
    assert.deepEqual(parseJsonColumn('pas du json'), {});
  });

  it('renvoie une copie, pas la référence', () => {
    const source = { a: 1 };
    const copy = parseJsonColumn(source);
    copy.b = 2;
    assert.equal(source.b, undefined);
  });
});

describe('classifyAttachment', () => {
  it('démasque un GIF déguisé en PNG', () => {
    // Renommer un fichier ne change pas sa nature : on croise extension
    // et type MIME.
    assert.equal(classifyAttachment({ name: 'x.gif', contentType: 'image/png' }), 'image');
    assert.equal(classifyAttachment({ name: 'x.gif', contentType: 'image/gif' }), 'gif');
  });

  it('classe les vidéos et les images', () => {
    assert.equal(classifyAttachment({ name: 'clip.mp4', contentType: 'video/mp4' }), 'video');
    assert.equal(classifyAttachment({ name: 'shot.png', contentType: 'image/png' }), 'image');
  });
});

describe('evaluateMessage', () => {
  it('laisse tout passer en politique libre', () => {
    const verdict = evaluateMessage({
      policyKey: 'free',
      content: 'https://example.com',
      attachments: [{ name: 'a.png', contentType: 'image/png' }],
    });
    assert.equal(verdict.allowed, true);
  });

  it('refuse une image dans un salon de discussion', () => {
    const verdict = evaluateMessage({
      policyKey: 'discussion',
      content: '',
      attachments: [{ name: 'a.png', contentType: 'image/png' }],
    });
    assert.equal(verdict.allowed, false);
    assert.ok(verdict.reason);
  });

  it('accepte un GIF dans un salon de discussion', () => {
    const verdict = evaluateMessage({
      policyKey: 'discussion',
      content: '',
      attachments: [{ name: 'a.gif', contentType: 'image/gif' }],
    });
    assert.equal(verdict.allowed, true);
  });

  it('laisse passer le texte seul partout', () => {
    const verdict = evaluateMessage({
      policyKey: 'discussion',
      content: 'salut tout le monde',
      attachments: [],
    });
    assert.equal(verdict.allowed, true);
  });

  it('ne bloque rien sur une politique inconnue', () => {
    const verdict = evaluateMessage({
      policyKey: 'inexistante',
      content: 'https://example.com',
      attachments: [],
    });
    assert.equal(verdict.allowed, true);
  });
});
