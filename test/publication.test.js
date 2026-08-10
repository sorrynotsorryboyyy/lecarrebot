import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { MessageFlags } from 'discord.js';
import {
  buildMention,
  buildPublication,
  isValidUrl,
  validatePublication,
} from '../src/lib/publication.js';

/**
 * Le moteur de publication est la pièce la plus critique à tester : un
 * conteneur V2 mal formé est rejeté par l'API Discord avec une erreur
 * opaque, et l'échec ne se voit qu'en production.
 */

/** Blocs d'un conteneur, par type. 12 = média, 10 = texte, 14 = séparateur. */
const blocks = (payload) => payload.components[0].toJSON().components.map((c) => c.type);

describe('isValidUrl', () => {
  it('accepte http et https', () => {
    assert.equal(isValidUrl('https://example.com/a.png'), true);
    assert.equal(isValidUrl('http://example.com'), true);
  });

  it('refuse les protocoles dangereux', () => {
    // Une URL `javascript:` dans un bouton serait au mieux rejetée par
    // Discord, au pire un vecteur d'abus.
    assert.equal(isValidUrl('javascript:alert(1)'), false);
    assert.equal(isValidUrl('data:text/html,<script>'), false);
    assert.equal(isValidUrl('ftp://example.com'), false);
  });

  it('refuse ce qui n\'est pas une URL', () => {
    assert.equal(isValidUrl(''), false);
    assert.equal(isValidUrl(null), false);
    assert.equal(isValidUrl('pas une url'), false);
    assert.equal(isValidUrl(42), false);
  });
});

describe('buildPublication', () => {
  it('place l\'image tout en haut', () => {
    // C'est la raison d'être des Components V2 ici : un embed classique
    // ne sait pas afficher d'image au-dessus du titre.
    const payload = buildPublication({
      title: 'Titre',
      body: 'Corps',
      imageUrl: 'https://example.com/a.png',
    });

    assert.equal(blocks(payload)[0], 12);
  });

  it('commence par le texte quand il n\'y a pas d\'image', () => {
    const payload = buildPublication({ title: 'Titre', body: 'Corps' });
    assert.equal(blocks(payload)[0], 10);
  });

  it('ignore une image invalide plutôt que d\'échouer', () => {
    // Perdre la bannière est acceptable ; perdre la publication ne l'est pas.
    const payload = buildPublication({
      title: 'Titre',
      imageUrl: 'javascript:alert(1)',
    });

    assert.equal(blocks(payload).includes(12), false);
  });

  it('pose le drapeau Components V2', () => {
    const payload = buildPublication({ title: 'Titre' });
    assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  });

  it('n\'émet ni content ni embeds', () => {
    // Les deux sont interdits sur un message V2 : leur présence ferait
    // rejeter l'envoi.
    const payload = buildPublication({ title: 'Titre', body: 'Corps' });
    assert.equal('content' in payload, false);
    assert.equal('embeds' in payload, false);
  });

  it('ajoute un bouton pour un lien valide', () => {
    const payload = buildPublication({
      title: 'Titre',
      linkUrl: 'https://example.com',
      linkLabel: 'Voir',
    });

    const rows = payload.components[0].toJSON().components.filter((c) => c.type === 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].components[0].url, 'https://example.com');
  });

  it('n\'ajoute pas de bouton pour un lien invalide', () => {
    const payload = buildPublication({ title: 'Titre', linkUrl: 'pas-une-url' });
    const rows = payload.components[0].toJSON().components.filter((c) => c.type === 1);
    assert.equal(rows.length, 0);
  });

  it('rend les champs libres', () => {
    const payload = buildPublication({
      title: 'Titre',
      fields: [{ name: 'Lot', value: '50 €' }],
    });

    const texts = payload.components[0].toJSON().components
      .filter((c) => c.type === 10)
      .map((c) => c.content)
      .join('\n');

    assert.match(texts, /Lot/);
    assert.match(texts, /50 €/);
  });

  it('survit à une publication vide', () => {
    // Un brouillon fraîchement créé n'a encore ni titre ni corps : l'aperçu
    // doit tout de même s'afficher.
    assert.doesNotThrow(() => buildPublication({}));
  });
});

describe('validatePublication', () => {
  it('exige un titre', () => {
    assert.deepEqual(validatePublication({}), ['Le titre est obligatoire.']);
    assert.deepEqual(validatePublication({ title: '   ' }), ['Le titre est obligatoire.']);
  });

  it('accepte une publication correcte', () => {
    assert.deepEqual(validatePublication({ title: 'Titre', body: 'Corps' }), []);
  });

  it('mesure le texte brut, pas le rendu tronqué', () => {
    // Le rendu tronque chaque bloc : valider sa sortie ne signalerait
    // jamais de dépassement, et le rédacteur verrait son texte amputé
    // sans comprendre pourquoi.
    const problems = validatePublication({ title: 'x', body: 'a'.repeat(4500) });
    assert.equal(problems.length, 1);
    assert.match(problems[0], /caractères/);
  });

  it('signale les liens malformés', () => {
    assert.equal(validatePublication({ title: 'x', imageUrl: 'nope' }).length, 1);
    assert.equal(validatePublication({ title: 'x', linkUrl: 'nope' }).length, 1);
  });

  it('limite le nombre de champs', () => {
    const fields = Array.from({ length: 11 }, (_, i) => ({ name: `n${i}`, value: 'v' }));
    assert.equal(validatePublication({ title: 'x', fields }).length, 1);
  });
});

describe('buildMention', () => {
  it('traduit everyone et here', () => {
    assert.deepEqual(buildMention('everyone'), {
      content: '@everyone',
      allowedMentions: { parse: ['everyone'] },
    });
    assert.equal(buildMention('here').content, '@here');
  });

  it('ne débloque qu\'un rôle précis', () => {
    // Jamais de `parse: ['roles']` : une mention glissée dans le texte de
    // l'annonce ne doit pas notifier un autre rôle au passage.
    const result = buildMention('123456789012345678');
    assert.deepEqual(result.allowedMentions, { roles: ['123456789012345678'] });
  });

  it('renvoie null sans mention', () => {
    assert.equal(buildMention(null), null);
    assert.equal(buildMention(''), null);
    assert.equal(buildMention('nimportequoi'), null);
  });
});
