import { createCanvas } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';

/**
 * Génération des défis de vérification.
 *
 * Trois modes tirés au sort à chaque arrivée : un scraper qui apprend à
 * résoudre un seul type de défi reste bloqué par les deux autres.
 *
 * Chaque générateur renvoie la même forme :
 *   { question, answer, choices, attachment? }
 * — `answer` est la valeur `customId` du bon bouton,
 * — `choices` est la liste { id, label, emoji? } des boutons à afficher.
 */

const COLORS = [
  { name: 'Rouge',  hex: '#ed4245', emoji: '🔴' },
  { name: 'Bleu',   hex: '#3b82f6', emoji: '🔵' },
  { name: 'Vert',   hex: '#57f287', emoji: '🟢' },
  { name: 'Jaune',  hex: '#fee75c', emoji: '🟡' },
  { name: 'Violet', hex: '#a855f7', emoji: '🟣' },
  { name: 'Orange', hex: '#f97316', emoji: '🟠' },
];

// Caractères sans ambiguïté visuelle : ni O/0, ni I/l/1.
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Mode 1 — Reconnaissance de couleur : un carré est dessiné, il faut le nommer. */
function colorChallenge() {
  const options = shuffle(COLORS).slice(0, 4);
  const target = pick(options);

  const canvas = createCanvas(320, 160);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, 320, 160);

  // Le carré, légèrement pivoté pour gêner l'analyse par pixel simple.
  ctx.save();
  ctx.translate(160, 80);
  ctx.rotate((rand(30) - 15) * Math.PI / 180);
  ctx.fillStyle = target.hex;
  ctx.fillRect(-55, -55, 110, 110);
  ctx.restore();

  // Bruit visuel
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`;
    ctx.fillRect(rand(320), rand(160), 2, 2);
  }

  return {
    question: 'Quelle est la **couleur** du carré affiché ci-dessous ?',
    answer: target.name,
    choices: options.map((c) => ({ id: c.name, label: c.name, emoji: c.emoji })),
    attachment: new AttachmentBuilder(canvas.toBuffer('image/png'), {
      name: 'captcha.png',
    }),
  };
}

/** Mode 2 — Lecture de code : 5 caractères déformés à retrouver parmi 4 propositions. */
function textChallenge() {
  const code = Array.from({ length: 5 }, () => pick([...CHARSET])).join('');

  const canvas = createCanvas(320, 120);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, 320, 120);

  // Lignes parasites derrière le texte
  for (let i = 0; i < 8; i++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.12})`;
    ctx.lineWidth = 1 + Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(rand(320), rand(120));
    ctx.lineTo(rand(320), rand(120));
    ctx.stroke();
  }

  // Chaque caractère est dessiné avec sa propre rotation et sa propre teinte.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [...code].forEach((char, i) => {
    ctx.save();
    ctx.translate(48 + i * 56, 60 + (rand(20) - 10));
    ctx.rotate((rand(40) - 20) * Math.PI / 180);
    ctx.font = `bold ${38 + rand(10)}px sans-serif`;
    ctx.fillStyle = `hsl(${rand(360)}, 70%, 72%)`;
    ctx.fillText(char, 0, 0);
    ctx.restore();
  });

  // Trois leurres proches du vrai code (un seul caractère change).
  const decoys = new Set();
  while (decoys.size < 3) {
    const chars = [...code];
    chars[rand(5)] = pick([...CHARSET]);
    const candidate = chars.join('');
    if (candidate !== code) decoys.add(candidate);
  }

  const options = shuffle([code, ...decoys]);

  return {
    question: 'Quel **code** est affiché sur l\'image ?',
    answer: code,
    choices: options.map((c) => ({ id: c, label: c })),
    attachment: new AttachmentBuilder(canvas.toBuffer('image/png'), {
      name: 'captcha.png',
    }),
  };
}

/** Mode 3 — Petit calcul : pas d'image, résiste bien à l'OCR automatisé. */
function mathChallenge() {
  const a = 2 + rand(8);
  const b = 2 + rand(8);
  const isSum = Math.random() > 0.4;

  const result = isSum ? a + b : Math.max(a, b) - Math.min(a, b);
  const symbol = isSum ? '+' : '−';
  const [left, right] = isSum ? [a, b] : [Math.max(a, b), Math.min(a, b)];

  const wrong = new Set();
  while (wrong.size < 3) {
    const delta = rand(5) - 2;
    const candidate = result + (delta === 0 ? 3 : delta);
    if (candidate !== result && candidate >= 0) wrong.add(candidate);
  }

  const options = shuffle([result, ...wrong]);

  return {
    question: `Combien font **${left} ${symbol} ${right}** ?`,
    answer: String(result),
    choices: options.map((n) => ({ id: String(n), label: String(n) })),
  };
}

const GENERATORS = [colorChallenge, textChallenge, mathChallenge];

/** Tire un défi au hasard parmi les trois modes. */
export function generateChallenge() {
  return pick(GENERATORS)();
}
